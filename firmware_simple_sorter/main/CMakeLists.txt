idf_component_register(SRCS "usb_descriptors.c" "main.cc" "bsp/board_api.cpp"
                       PRIV_REQUIRES spi_flash rgbled esp_driver_spi errorcodes
                       INCLUDE_DIRS ".")
idf_component_get_property(tusb_lib espressif__tinyusb COMPONENT_LIB)
target_include_directories(${tusb_lib} PRIVATE ".")