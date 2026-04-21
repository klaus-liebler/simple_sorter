#include "listener/rgb_message_processor.hh"

namespace listener {

RGBMessageProcessor::RGBMessageProcessor(RGBLED::M<1, RGBLED::DeviceType::WS2812>& board_led)
  : board_led_(board_led) {
}

void RGBMessageProcessor::Handle(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload) {
  (void)context;
  (void)message_id;

  if (payload == nullptr) {
    return;
  }

  CRGB const color(payload[0], payload[1], payload[2]);
  board_led_.SetPixel(0, color);
}

}  // namespace listener