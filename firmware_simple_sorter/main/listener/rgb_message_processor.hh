#pragma once

#include "listener/interfaces.hh"
#include "rgbled.hh"

namespace listener {

class RGBMessageProcessor final : public INamespaceListener {
public:
  static constexpr uint16_t kNamespaceRgb = 0x0002;

  explicit RGBMessageProcessor(RGBLED::M<1, RGBLED::DeviceType::WS2812>& board_led);

  void Handle(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload) override;

private:
  RGBLED::M<1, RGBLED::DeviceType::WS2812>& board_led_;
};

}  // namespace listener