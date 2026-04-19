#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

void board_init(void);
void board_init_after_tusb(void);
void board_led_write(bool led_state);
uint32_t board_millis(void);

// Input is USB string descriptor payload from index 1 (index 0 is type + len).
size_t board_usb_get_serial(uint16_t desc_str1[], size_t max_chars);

#ifdef __cplusplus
}
#endif