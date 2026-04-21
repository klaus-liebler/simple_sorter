#pragma once

#include <stdint.h>

#include "driver/gpio.h"
#include "listener/interfaces.hh"

namespace listener {

class ServoMessageProcessor final : public IMessageProcessor {
public:
  static constexpr uint16_t kNamespaceServo = 0x0003;

  explicit ServoMessageProcessor(gpio_num_t servo_pin);
  void Setup(ISendBackInterface& context, uint32_t now_ms) override;

  void Handle(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload) override;
  uint16_t GetNamespace() const override;

private:
  gpio_num_t servo_pin_;

  enum class eDynamicPosition {
    NO_DYNAMICS   = 0,
    RIGHT  = 1,
    MIDDLE = 2,
    LEFT   = 3,
  };
  eDynamicPosition currentDynamicPosition = eDynamicPosition::NO_DYNAMICS;
  uint8_t currentPosition = 128;
  uint8_t appliedPosition_ = 0;

  uint8_t  wiggle_pos_     = 60;
  uint32_t wiggle_next_ms_ = 0;

  void SetPosition(uint8_t position);
  void HandleSetPosition(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload);
  void HandleDynamicMessage(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload);
  void Loop(ISendBackInterface& context, uint32_t now_ms) override;
};

}  // namespace listener