#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <stdarg.h>
#include <fcntl.h>
#include <sys/types.h>
#include <unistd.h>

#include "sdkconfig.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_system.h"
#include "esp_vfs.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "rgbled.hh"
#include "esp_rom_gpio.h"

#include "hal/gpio_ll.h"

#include "driver/gpio.h"
#include "driver/uart.h"
#include "tinyusb_default_config.h"
#include "tinyusb.h"
#include "tinyusb_default_config.h"
#include "tinyusb_cdc_acm.h"
#include "tinyusb_console.h"

#include "listener/echo_message_processor.hh"
#include "listener/rgb_message_processor.hh"
#include "listener/servo_message_processor.hh"
#include "usb_descriptors.h"

#define URL "liebler.iui.hs-osnabrueck.de/rgb/"
constexpr char MONITOR_LOG_TAG[] = "monitor";
constexpr gpio_num_t BUTTON_PIN{GPIO_NUM_0};
constexpr int BUTTON_STATE_ACTIVE{0};
constexpr gpio_num_t LED_PIN{GPIO_NUM_21};
constexpr gpio_num_t SERVO_PIN{GPIO_NUM_6};
constexpr TickType_t CDC_LOG_WRITE_TIMEOUT_TICKS = pdMS_TO_TICKS(20);
constexpr uint32_t BINARY_MSG_SIZE = 64;
constexpr uint16_t BINARY_PAYLOAD_SIZE = 60;

inline uint16_t ReadU16Le(const uint8_t *data)
{
  return static_cast<uint16_t>(data[0] | (static_cast<uint16_t>(data[1]) << 8));
}

inline void WriteU16Le(uint8_t *data, uint16_t value)
{
  data[0] = static_cast<uint8_t>(value & 0xFF);
  data[1] = static_cast<uint8_t>((value >> 8) & 0xFF);
}

class VendorSendBack final : public ISendBackInterface
{
public:
  bool Send(uint16_t name_space, uint16_t message_id, const uint8_t *payload) override
  {
    if (payload == nullptr)
    {
      return false;
    }

    uint8_t frame[BINARY_MSG_SIZE] = {};
    WriteU16Le(frame + 0, name_space);
    WriteU16Le(frame + 2, message_id);
    memcpy(frame + 4, payload, BINARY_PAYLOAD_SIZE);

    if (tud_vendor_write_available() < BINARY_MSG_SIZE)
    {
      return false;
    }

    uint32_t const written = tud_vendor_write(frame, BINARY_MSG_SIZE);
    tud_vendor_write_flush();
    return written == BINARY_MSG_SIZE;
  }
};

bool board_button_pressed(void)
{
  return gpio_get_level(BUTTON_PIN) == BUTTON_STATE_ACTIVE;
}

/* Blink pattern
 * - 250 ms  : device not mounted
 * - 1000 ms : device mounted
 * - 2500 ms : device is suspended
 */
RGBLED::BlinkPattern NOT_MOUNTED(CRGB::Red, 250, CRGB::Black, 250);
RGBLED::BlinkPattern MOUNTED(CRGB::Green, 1000, CRGB::Black, 1000);
RGBLED::BlinkPattern SUSPENDED(CRGB::Blue, 250, CRGB::Black, 2250);
RGBLED::MultipleFlashesPattern USB_INIT_FAILED(CRGB::Red, 2);

RGBLED::M<1, RGBLED::DeviceType::WS2812> s_board_led;
ISendBackInterface *s_sendBack;
int (*s_previous_log_vprintf)(const char *, va_list) = nullptr;

struct webusb_url_desc_t
{
  uint8_t bLength;
  uint8_t bDescriptorType;
  uint8_t bScheme;
  char url[sizeof(URL)];
};

static const webusb_url_desc_t desc_url = {
    .bLength = static_cast<uint8_t>(3 + sizeof(URL) - 1),
    .bDescriptorType = 3, // WEBUSB URL type
    .bScheme = 1,         // 0: http, 1: https
    .url = URL};

static std::array<IMessageProcessor *, 3> message_processors{
    new listener::EchoMessageProcessor(),
    new listener::RGBMessageProcessor(s_board_led),
    new listener::ServoMessageProcessor(SERVO_PIN),
};

IMessageProcessor *FindNamespaceProcessor(uint16_t name_space)
{
  for (auto processor : message_processors)
  {
    if (processor != nullptr && processor->GetNamespace() == name_space)
    {
      return processor;
    }
  }
  return nullptr;
}

static void processing_task(void *context)
{
  (void)context;

  while (true)
  {
    s_board_led.Refresh();
    uint32_t const now_ms = static_cast<uint32_t>(esp_timer_get_time() / 1000);
    for (auto *processor : message_processors)
    {
      if (processor != nullptr)
      {
        processor->Loop(*s_sendBack, now_ms);
      }
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

  static void device_event_handler(tinyusb_event_t *event, void *arg)
  {
    switch (event->id) {
    case TINYUSB_EVENT_ATTACHED:
    case TINYUSB_EVENT_DETACHED:
    default:
        break;
    }
  }

static uint8_t rx_buf[CONFIG_TINYUSB_CDC_RX_BUFSIZE + 1];
extern "C" void tinyusb_cdc_rx_callback(int  itf_as_int, cdcacm_event_t *event)
{
  (void)event;
  tinyusb_cdcacm_itf_t itf = static_cast<tinyusb_cdcacm_itf_t>(itf_as_int);
  size_t rx_size = 0;
  ESP_ERROR_CHECK(tinyusb_cdcacm_read(itf, rx_buf, CONFIG_TINYUSB_CDC_RX_BUFSIZE, &rx_size));
}


extern "C" void app_main(void)
{

  usb_descriptors_init();

  s_sendBack = new VendorSendBack();

  s_board_led.Begin(SPI2_HOST, GPIO_NUM_21);

  for (auto *processor : message_processors)
  {
    if (processor != nullptr)
    {
      processor->Setup(*s_sendBack, 0);
    }
  }

  esp_rom_gpio_pad_select_gpio(BUTTON_PIN);
  gpio_set_direction(BUTTON_PIN, GPIO_MODE_INPUT);
  gpio_set_pull_mode(BUTTON_PIN, BUTTON_STATE_ACTIVE ? GPIO_PULLDOWN_ONLY : GPIO_PULLUP_ONLY);


  tinyusb_config_t tusb_cfg = TINYUSB_DEFAULT_CONFIG(device_event_handler);
  tusb_cfg.descriptor.device = &g_usb_device_descriptor;
  tusb_cfg.descriptor.string = g_usb_string_descriptor;
  tusb_cfg.descriptor.string_count = g_usb_string_descriptor_count;
  tusb_cfg.descriptor.full_speed_config = g_usb_full_speed_configuration_descriptor;
  ESP_ERROR_CHECK(tinyusb_driver_install(&tusb_cfg));
  tinyusb_config_cdcacm_t acm_cfg = {
      .cdc_port = TINYUSB_CDC_ACM_0,
      .callback_rx = &tinyusb_cdc_rx_callback,
      .callback_rx_wanted_char = nullptr,
      .callback_line_state_changed = nullptr,
      .callback_line_coding_changed = nullptr,
  };
  ESP_ERROR_CHECK(tinyusb_cdcacm_init(&acm_cfg));
  ESP_ERROR_CHECK(tinyusb_console_init(TINYUSB_CDC_ACM_0)); // log to usb CDC-ACM interface
  

  
  // s_previous_log_vprintf = esp_log_set_vprintf(cdc_log_vprintf);

  xTaskCreate(processing_task, "processing", 4096, nullptr, tskIDLE_PRIORITY + 2, nullptr);
  

  while (1)
  {
    char buf[64];
    
    while (true)
    {
      ESP_LOGI(
          MONITOR_LOG_TAG,
          "mntd=%d sspnd=%d cdc_cnctd=%d cdc_rx=%u cdc_tx_free=%u btn=%d heap=%lu",
               tud_mounted() ? 1 : 0,
               tud_suspended() ? 1 : 0,
               tud_cdc_connected() ? 1 : 0,
               static_cast<unsigned>(tud_cdc_available()),
               static_cast<unsigned>(tud_cdc_write_available()),
               board_button_pressed() ? 1 : 0,
               static_cast<unsigned long>(esp_get_free_heap_size()));
      vTaskDelay(pdMS_TO_TICKS(3000));
    }
  }
}

static void process_vendor_binary_message(const uint8_t msg[BINARY_MSG_SIZE])
{
  uint16_t const name_space = ReadU16Le(msg + 0);
  uint16_t const message_id = ReadU16Le(msg + 2);
  uint8_t const *payload = msg + 4;

  IMessageProcessor *message_listener = FindNamespaceProcessor(name_space);
  if (message_listener == nullptr)
  {
    return;
  }

  message_listener->Handle(*s_sendBack, message_id, payload);
}




//--------------------------------------------------------------------+
// WebUSB use vendor class
//--------------------------------------------------------------------+

// Invoked when a control transfer occurred on an interface of this class
// Driver response accordingly to the request and the transfer stage (setup/data/ack)
// return false to stall control endpoint (e.g unsupported request)
extern "C" bool tud_vendor_control_xfer_cb(uint8_t rhport, uint8_t stage, tusb_control_request_t const *request)
{
  // nothing to with DATA & ACK stage
  if (stage != CONTROL_STAGE_SETUP)
  {
    return true;
  }

  switch (request->bmRequestType_bit.type)
  {
  case TUSB_REQ_TYPE_VENDOR:
    switch (request->bRequest)
    {
    case VENDOR_REQUEST_WEBUSB:
      // match vendor request in BOS descriptor
      // Get landing page url
      return tud_control_xfer(rhport, request, (void *)(uintptr_t)&desc_url, desc_url.bLength);

    case VENDOR_REQUEST_MICROSOFT:
      if (request->wIndex == 7)
      {
        // Get Microsoft OS 2.0 compatible descriptor
        uint16_t total_len;
        memcpy(&total_len, desc_ms_os_20 + 8, 2);

        return tud_control_xfer(rhport, request, (void *)(uintptr_t)desc_ms_os_20, total_len);
      }
      else
      {
        return false;
      }

    default:
      break;
    }
    break;

  default:
    break;
  }

  // stall unknown request
  return false;
}

extern "C" void tud_vendor_rx_cb(uint8_t idx, const uint8_t *buffer, uint16_t bufsize)
{
  (void)idx;
  (void)buffer;
  (void)bufsize;

  while (tud_vendor_available() >= BINARY_MSG_SIZE)
  {
    uint8_t msg[BINARY_MSG_SIZE];
    uint32_t const count = tud_vendor_read(msg, BINARY_MSG_SIZE);
    if (count == BINARY_MSG_SIZE)
    {
      process_vendor_binary_message(msg);
    }
  }
}


