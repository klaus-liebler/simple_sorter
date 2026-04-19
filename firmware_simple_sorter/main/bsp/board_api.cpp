#include "board_api.h"

#include "esp_mac.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "rgbled.hh"

static RGBLED::M<1, RGBLED::DeviceType::WS2812> s_board_led;
static bool s_board_led_initialized = false;

extern "C" void board_init(void) {
    if (s_board_led_initialized) {
        return;
    }

    if (s_board_led.Begin(SPI2_HOST, GPIO_NUM_21) == ErrorCode::OK) {
        s_board_led_initialized = true;
    }
}

extern "C" void board_init_after_tusb(void) {
}

extern "C" void board_led_write(bool led_state) {
    if (!s_board_led_initialized) {
        return;
    }

    s_board_led.SetPixel(0, led_state ? CRGB(12, 12, 12) : CRGB(0, 0, 0));
    s_board_led.Refresh();
}

extern "C" uint32_t board_millis(void) {
    return (uint32_t) (xTaskGetTickCount() * portTICK_PERIOD_MS);
}

extern "C" size_t board_usb_get_serial(uint16_t desc_str1[], size_t max_chars) {
    uint8_t mac[6];
    esp_efuse_mac_get_default(mac);

    size_t const serial_chars = 12;
    if (max_chars < serial_chars) {
        return 0;
    }

    static const char nibble_to_hex[16] = {
        '0', '1', '2', '3', '4', '5', '6', '7',
        '8', '9', 'A', 'B', 'C', 'D', 'E', 'F'};

    for (size_t i = 0; i < 6; i++) {
        desc_str1[i * 2] = nibble_to_hex[(mac[i] >> 4) & 0x0F];
        desc_str1[i * 2 + 1] = nibble_to_hex[mac[i] & 0x0F];
    }

    return serial_chars;
}
