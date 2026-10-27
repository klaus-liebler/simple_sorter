#pragma once

#include "listener/interfaces.hh"
#include "rgb_strip.hh"

namespace listener {

class RGBMessageProcessor final : public IMessageProcessor {
public:
  static constexpr uint16_t kNamespaceRgb = 0x0002;

  explicit RGBMessageProcessor(led::RgbStrip<1, led::DeviceType::WS2812>& board_led);

  void Handle(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload) override;
  uint16_t GetNamespace() const override;

private:
  led::RgbStrip<1, led::DeviceType::WS2812>& board_led_;
};

}  // namespace listener