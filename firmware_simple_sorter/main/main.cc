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
#include "esp_private/usb_phy.h"

#include "tusb_config.h"
#include "tusb.h"
#include "listener/echo_namespace_listener.hh"
#include "listener/rgb_message_processor.hh"
#include "listener/servo_message_processor.hh"
#include "usb_descriptors.h"


constexpr gpio_num_t BUTTON_PIN{GPIO_NUM_0};
constexpr int BUTTON_STATE_ACTIVE{0};
constexpr gpio_num_t LED_PIN{GPIO_NUM_21};
constexpr gpio_num_t SERVO_PIN{GPIO_NUM_6};

/* Blink pattern
 * - 250 ms  : device not mounted
 * - 1000 ms : device mounted
 * - 2500 ms : device is suspended
 */
RGBLED::BlinkPattern NOT_MOUNTED(CRGB::Red, 250, CRGB::Black, 250);
RGBLED::BlinkPattern MOUNTED(CRGB::Green, 1000, CRGB::Black, 1000);
RGBLED::BlinkPattern SUSPENDED(CRGB::Blue, 250, CRGB::Black, 2250);
//RGBLED::MultipleFlashesPattern USB_INIT_FAILED(CRGB::Red, 2);


static RGBLED::M<1, RGBLED::DeviceType::WS2812> s_board_led;
static usb_phy_handle_t phy_hdl;
static int (*s_previous_log_vprintf)(const char*, va_list) = nullptr;

static constexpr char MONITOR_LOG_TAG[] = "monitor";

#define URL  "liebler.iui.hs-osnabrueck.de/rgb/"

static constexpr TickType_t CDC_LOG_WRITE_TIMEOUT_TICKS = pdMS_TO_TICKS(20);

static bool board_button_pressed(void);

static void cdc_write_with_timeout(const char* data, size_t len, TickType_t timeout_ticks) {
  if (data == nullptr || len == 0) {
    return;
  }

  TickType_t const start = xTaskGetTickCount();
  while (len > 0) {
    uint32_t const avail = tud_cdc_write_available();
    if (avail == 0) {
      if ((xTaskGetTickCount() - start) >= timeout_ticks) {
        break;
      }
      vTaskDelay(1);
      continue;
    }

    size_t chunk_len = len;
    if (chunk_len > static_cast<size_t>(avail)) {
      chunk_len = static_cast<size_t>(avail);
    }

    uint32_t const written = tud_cdc_write(data, chunk_len);
    if (written == 0) {
      if ((xTaskGetTickCount() - start) >= timeout_ticks) {
        break;
      }
      vTaskDelay(1);
      continue;
    }

    data += written;
    len -= written;
  }
}

static int cdc_log_vprintf(const char* fmt, va_list args) {
  va_list args_for_prev;
  va_list args_for_cdc;
  va_copy(args_for_prev, args);
  va_copy(args_for_cdc, args);

  int printed = 0;
  if (s_previous_log_vprintf != nullptr) {
    printed = s_previous_log_vprintf(fmt, args_for_prev);
  }
  va_end(args_for_prev);

  if (xPortInIsrContext()) {
    va_end(args_for_cdc);
    return printed;
  }

  char line[258];
  int const line_len = vsnprintf(line, sizeof(line) - 2, fmt, args_for_cdc);
  va_end(args_for_cdc);

  if (line_len <= 0 || !tud_cdc_connected()) {
    return printed;
  }

  size_t to_send = static_cast<size_t>(line_len);
  if (to_send > (sizeof(line) - 2)) {
    to_send = sizeof(line) - 2;
  }

  cdc_write_with_timeout(line, to_send, CDC_LOG_WRITE_TIMEOUT_TICKS);
  tud_cdc_write_flush();

  return printed;
}

struct webusb_url_desc_t {
  uint8_t bLength;
  uint8_t bDescriptorType;
  uint8_t bScheme;
  char url[sizeof(URL)];
};

static const webusb_url_desc_t desc_url = {
  .bLength = static_cast<uint8_t>(3 + sizeof(URL) - 1),
  .bDescriptorType = 3, // WEBUSB URL type
  .bScheme = 1, // 0: http, 1: https
  .url = URL
};

static listener::EchoNamespaceListener s_echo_listener;
static listener::RGBMessageProcessor s_rgb_message_processor(s_board_led);
static listener::ServoMessageProcessor s_servo_message_processor(SERVO_PIN);

namespace listener {

static constexpr uint32_t BINARY_MSG_SIZE = 64;
static constexpr uint16_t BINARY_PAYLOAD_SIZE = 60;

inline uint16_t ReadU16Le(const uint8_t* data) {
  return static_cast<uint16_t>(data[0] | (static_cast<uint16_t>(data[1]) << 8));
}

inline void WriteU16Le(uint8_t* data, uint16_t value) {
  data[0] = static_cast<uint8_t>(value & 0xFF);
  data[1] = static_cast<uint8_t>((value >> 8) & 0xFF);
}

struct NamespaceListenerEntry {
  uint16_t name_space;
  INamespaceListener* listener;
};

static constexpr size_t MAX_NAMESPACE_LISTENERS = 8;
static NamespaceListenerEntry s_namespace_listeners[MAX_NAMESPACE_LISTENERS] = {};

bool RegisterNamespaceListener(uint16_t name_space, INamespaceListener* listener) {
  if (listener == nullptr) {
    return false;
  }

  for (size_t i = 0; i < MAX_NAMESPACE_LISTENERS; i++) {
    if (s_namespace_listeners[i].listener != nullptr && s_namespace_listeners[i].name_space == name_space) {
      s_namespace_listeners[i].listener = listener;
      return true;
    }
  }

  for (size_t i = 0; i < MAX_NAMESPACE_LISTENERS; i++) {
    if (s_namespace_listeners[i].listener == nullptr) {
      s_namespace_listeners[i].name_space = name_space;
      s_namespace_listeners[i].listener = listener;
      return true;
    }
  }

  return false;
}

INamespaceListener* FindNamespaceListener(uint16_t name_space) {
  for (size_t i = 0; i < MAX_NAMESPACE_LISTENERS; i++) {
    if (s_namespace_listeners[i].listener != nullptr && s_namespace_listeners[i].name_space == name_space) {
      return s_namespace_listeners[i].listener;
    }
  }

  return nullptr;
}

class VendorSendBack final : public ISendBackInterface {
public:
  bool Send(uint16_t name_space, uint16_t message_id, const uint8_t* payload) override {
    if (payload == nullptr) {
      return false;
    }

    uint8_t frame[BINARY_MSG_SIZE] = {};
    WriteU16Le(frame + 0, name_space);
    WriteU16Le(frame + 2, message_id);
    memcpy(frame + 4, payload, BINARY_PAYLOAD_SIZE);

    if (tud_vendor_write_available() < BINARY_MSG_SIZE) {
      return false;
    }

    uint32_t const written = tud_vendor_write(frame, BINARY_MSG_SIZE);
    tud_vendor_write_flush();
    return written == BINARY_MSG_SIZE;
  }
};

}  // namespace listener




static void monitoring_task(void* context) {
  (void)context;

  while (true) {
    ESP_LOGI(
      MONITOR_LOG_TAG,
      "uptime_ms=%lu mounted=%d suspended=%d cdc_connected=%d cdc_rx=%u cdc_tx_free=%u button=%d heap=%lu",
      static_cast<unsigned long>(xTaskGetTickCount() * portTICK_PERIOD_MS),
      tud_mounted() ? 1 : 0,
      tud_suspended() ? 1 : 0,
      tud_cdc_connected() ? 1 : 0,
      static_cast<unsigned>(tud_cdc_available()),
      static_cast<unsigned>(tud_cdc_write_available()),
      board_button_pressed() ? 1 : 0,
      static_cast<unsigned long>(esp_get_free_heap_size()));
    printf(
      "uptime_ms=%lu mounted=%d suspended=%d cdc_connected=%d cdc_rx=%u cdc_tx_free=%u button=%d heap=%lu\r\n",
      static_cast<unsigned long>(xTaskGetTickCount() * portTICK_PERIOD_MS),
      tud_mounted() ? 1 : 0,
      tud_suspended() ? 1 : 0,
      tud_cdc_connected() ? 1 : 0,
      static_cast<unsigned>(tud_cdc_available()),
      static_cast<unsigned>(tud_cdc_write_available()),
      board_button_pressed() ? 1 : 0,
      static_cast<unsigned long>(esp_get_free_heap_size()));
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}


bool board_button_pressed(void) {
  return gpio_get_level(BUTTON_PIN) == BUTTON_STATE_ACTIVE;
}


extern "C" void app_main(void) {
  
  s_board_led.Begin(SPI2_HOST, GPIO_NUM_21);
  (void)s_servo_message_processor.Begin();
  listener::RegisterNamespaceListener(listener::EchoNamespaceListener::kNamespaceEcho, &s_echo_listener);
  listener::RegisterNamespaceListener(listener::RGBMessageProcessor::kNamespaceRgb, &s_rgb_message_processor);
  listener::RegisterNamespaceListener(listener::ServoMessageProcessor::kNamespaceServo, &s_servo_message_processor);
  
  esp_rom_gpio_pad_select_gpio(BUTTON_PIN);
  gpio_set_direction(BUTTON_PIN, GPIO_MODE_INPUT);
  gpio_set_pull_mode(BUTTON_PIN, BUTTON_STATE_ACTIVE ? GPIO_PULLDOWN_ONLY : GPIO_PULLUP_ONLY);

  usb_phy_config_t phy_conf = {};
  phy_conf.controller = USB_PHY_CTRL_OTG;
  phy_conf.target = USB_PHY_TARGET_INT;
  phy_conf.otg_mode = USB_OTG_MODE_DEVICE;
  // https://github.com/hathach/tinyusb/issues/2943#issuecomment-2601888322
  // Set speed to undefined (auto-detect) to avoid timing/racing issue with S3 hosts such as macOS.
  phy_conf.otg_speed = USB_PHY_SPEED_UNDEFINED;

  esp_err_t const err = usb_new_phy(&phy_conf, &phy_hdl);
  if (err != ESP_OK) {
    printf("usb_new_phy failed: %s\r\n", esp_err_to_name(err));
    phy_hdl = nullptr;
    //s_board_led.AnimatePixel(0, &USB_INIT_FAILED);
    while (1) {
      s_board_led.Refresh();
      vTaskDelay(pdMS_TO_TICKS(20));
    }
  }

  // init device stack on configured roothub port
  tusb_rhport_init_t dev_init = {
    .role = TUSB_ROLE_DEVICE,
    .speed = TUSB_SPEED_AUTO
  };
  tusb_init(BOARD_TUD_RHPORT, &dev_init);

  s_previous_log_vprintf = esp_log_set_vprintf(cdc_log_vprintf);

  xTaskCreate(monitoring_task, "monitoring", 4096, nullptr, tskIDLE_PRIORITY + 1, nullptr);

  while (1) {
    tud_task(); // tinyusb device task
    tud_cdc_write_flush();
    s_board_led.Refresh();
  }
}

static void process_vendor_binary_message(const uint8_t msg[listener::BINARY_MSG_SIZE]) {
  uint16_t const name_space = listener::ReadU16Le(msg + 0);
  uint16_t const message_id = listener::ReadU16Le(msg + 2);
  uint8_t const* payload = msg + 4;

  listener::INamespaceListener* message_listener = listener::FindNamespaceListener(name_space);
  if (message_listener == nullptr) {
    return;
  }

  listener::VendorSendBack context;
  message_listener->Handle(context, message_id, payload);
}

//--------------------------------------------------------------------+
// Device callbacks
//--------------------------------------------------------------------+

// Invoked when device is mounted
extern "C" void tud_mount_cb(void) {
  s_board_led.AnimatePixel(0, &MOUNTED);
}

// Invoked when device is unmounted
extern "C" void tud_umount_cb(void) {
  s_board_led.AnimatePixel(0, &NOT_MOUNTED);
}

// Invoked when usb bus is suspended
// remote_wakeup_en : if host allow us  to perform remote wakeup
// Within 7ms, device must draw an average of current less than 2.5 mA from bus
extern "C" void tud_suspend_cb(bool remote_wakeup_en) {
  (void)remote_wakeup_en;
  s_board_led.AnimatePixel(0, &SUSPENDED);
}

// Invoked when usb bus is resumed
extern "C" void tud_resume_cb(void) {
  s_board_led.AnimatePixel(0, tud_mounted() ? &MOUNTED : &NOT_MOUNTED);
}

//--------------------------------------------------------------------+
// WebUSB use vendor class
//--------------------------------------------------------------------+

// Invoked when a control transfer occurred on an interface of this class
// Driver response accordingly to the request and the transfer stage (setup/data/ack)
// return false to stall control endpoint (e.g unsupported request)
extern "C" bool tud_vendor_control_xfer_cb(uint8_t rhport, uint8_t stage, tusb_control_request_t const* request) {
  // nothing to with DATA & ACK stage
  if (stage != CONTROL_STAGE_SETUP) {
    return true;
  }

  switch (request->bmRequestType_bit.type) {
    case TUSB_REQ_TYPE_VENDOR:
      switch (request->bRequest) {
        case VENDOR_REQUEST_WEBUSB:
          // match vendor request in BOS descriptor
          // Get landing page url
          return tud_control_xfer(rhport, request, (void*)(uintptr_t)&desc_url, desc_url.bLength);

        case VENDOR_REQUEST_MICROSOFT:
          if (request->wIndex == 7) {
            // Get Microsoft OS 2.0 compatible descriptor
            uint16_t total_len;
            memcpy(&total_len, desc_ms_os_20 + 8, 2);

            return tud_control_xfer(rhport, request, (void*)(uintptr_t)desc_ms_os_20, total_len);
          } else {
            return false;
          }

        default: break;
      }
      break;

    default: break;
  }

  // stall unknown request
  return false;
}

extern "C" void tud_vendor_rx_cb(uint8_t idx, const uint8_t *buffer, uint16_t bufsize) {
  (void)idx;
  (void)buffer;
  (void)bufsize;

  while (tud_vendor_available() >= listener::BINARY_MSG_SIZE) {
    uint8_t msg[listener::BINARY_MSG_SIZE];
    uint32_t const count = tud_vendor_read(msg, listener::BINARY_MSG_SIZE);
    if (count == listener::BINARY_MSG_SIZE) {
      process_vendor_binary_message(msg);
    }
  }
}

//--------------------------------------------------------------------+
// USB CDC
//--------------------------------------------------------------------+

// Invoked when cdc line state changed e.g connected/disconnected
extern "C" void tud_cdc_line_state_cb(uint8_t itf, bool dtr, bool rts) {
  (void)itf;

  // connected
  if (dtr && rts) {
    tud_cdc_write_str("\r\nKlaus Lieblers WebUSB device example\r\n");
    tud_cdc_write_flush();
  }
}

// Invoked when CDC interface received data from host
extern "C" void tud_cdc_rx_cb(uint8_t idx) {
  (void)idx;
  while (tud_cdc_available()) {
    uint8_t buf[64];
    uint32_t const count = tud_cdc_read(buf, sizeof(buf));
    tud_cdc_write(buf, count);
  }
  tud_cdc_write_flush();
}
