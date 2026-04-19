#include <stdlib.h>
#include <stdio.h>
#include <string.h>

#include "esp_mac.h"
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
#include "usb_descriptors.h"


constexpr gpio_num_t BUTTON_PIN{GPIO_NUM_0};
constexpr int BUTTON_STATE_ACTIVE{0};
constexpr gpio_num_t LED_PIN{GPIO_NUM_21};

/* Blink pattern
 * - 250 ms  : device not mounted
 * - 1000 ms : device mounted
 * - 2500 ms : device is suspended
 */
RGBLED::BlinkPattern NOT_MOUNTED(CRGB::Red, 250, CRGB::Black, 250);
RGBLED::BlinkPattern MOUNTED(CRGB::Green, 1000, CRGB::Black, 1000);
RGBLED::BlinkPattern SUSPENDED(CRGB::Blue, 250, CRGB::Black, 2250);
RGBLED::MultipleFlashesPattern USB_INIT_FAILED(CRGB::Red, 2);


static RGBLED::M<1, RGBLED::DeviceType::WS2812> s_board_led;
static usb_phy_handle_t phy_hdl;

#define URL  "example.tinyusb.org/webusb-serial/index.html"

const tusb_desc_webusb_url_t desc_url = {
  .bLength         = 3 + sizeof(URL) - 1,
  .bDescriptorType = 3, // WEBUSB URL type
  .bScheme         = 1, // 0: http, 1: https
  .url             = URL
};

static bool web_serial_connected = false;


bool board_button_pressed(void) {
  return gpio_get_level(BUTTON_PIN) == BUTTON_STATE_ACTIVE;
}

// Get characters from UART
int board_uart_read(uint8_t* buf, int len) {
  for (int i=0; i<len; i++) {
    int c = getchar();
    if (c == EOF) {
      return i;
    }
    buf[i] = (uint8_t) c;
  }
  return len;
}

// Send characters to UART
int board_uart_write(void const* buf, int len) {
  for (int i = 0; i < len; i++) {
    putchar(((char*) buf)[i]);
  }
  return len;
}

int board_getchar(void) {
  return getchar();
}

int board_putchar(int c) {
  return putchar(c);
}

extern "C" void app_main(void) {
  s_board_led.Begin(SPI2_HOST, GPIO_NUM_21);
  
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
    s_board_led.AnimatePixel(0, &USB_INIT_FAILED);
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

  while (1) {
    tud_task(); // tinyusb device task
    tud_cdc_write_flush();
    s_board_led.Refresh();
  }
}

// send characters to both CDC and WebUSB
static void echo_all(const uint8_t buf[], uint32_t count) {
  // echo to web serial
  if (web_serial_connected) {
    tud_vendor_write(buf, count);
    tud_vendor_write_flush();
  }

  // echo to cdc
  if (tud_cdc_connected()) {
    tud_cdc_write(buf, count);
  }
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

    case TUSB_REQ_TYPE_CLASS:
      if (request->bRequest == 0x22) {
        // Webserial simulate the CDC_REQUEST_SET_CONTROL_LINE_STATE (0x22) to connect and disconnect.
        web_serial_connected = (request->wValue != 0);

        // Always lit LED if connected
        if (web_serial_connected) {
          s_board_led.SetPixel(0, CRGB::Green);
          tud_vendor_write_str("\r\nWebUSB interface connected\r\n");
          tud_vendor_write_flush();
        } else {
          s_board_led.AnimatePixel(0, &MOUNTED);
        }

        // response with status OK
        return tud_control_status(rhport, request);
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

  while (tud_vendor_available()) {
    uint8_t        buf[64];
    const uint32_t count = tud_vendor_read(buf, sizeof(buf));
    echo_all(buf, count);
  }
}

//--------------------------------------------------------------------+
// USB CDC
//--------------------------------------------------------------------+

// Invoked when cdc when line state changed e.g connected/disconnected
extern "C" void tud_cdc_line_state_cb(uint8_t itf, bool dtr, bool rts) {
  (void)itf;

  // connected
  if (dtr && rts) {
    // print initial message when connected
    tud_cdc_write_str("\r\nTinyUSB WebUSB device example\r\n");
  }
}

// Invoked when CDC interface received data from host
extern "C" void tud_cdc_rx_cb(uint8_t idx) {
  (void)idx;
  while (tud_cdc_available()) {
    uint8_t        buf[64];
    const uint32_t count = tud_cdc_read(buf, sizeof(buf));
    echo_all(buf, count); // echo back to both web serial and cdc
  }
}
