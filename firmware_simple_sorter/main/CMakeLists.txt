idf_component_register(SRCS "usb_descriptors.c" "main.cc"
                            "listener/echo_message_processor.cc"
                            "listener/rgb_message_processor.cc"
                            "listener/servo_message_processor.cc"
                       PRIV_REQUIRES spi_flash rgbled esp_driver_spi esp_driver_uart esp_driver_gpio esp_driver_ledc errorcodes tinyusb
                       INCLUDE_DIRS ".")
idf_component_get_property(tusb_lib espressif__tinyusb COMPONENT_LIB)
