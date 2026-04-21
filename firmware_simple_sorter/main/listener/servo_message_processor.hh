#pragma once

#include <stdint.h>

#include "driver/gpio.h"
#include "listener/interfaces.hh"

namespace listener {

class ServoMessageProcessor final : public INamespaceListener {
public:
  static constexpr uint16_t kNamespaceServo = 0x0003;

  explicit ServoMessageProcessor(gpio_num_t servo_pin);

  bool Begin();
  void Handle(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload) override;

private:
  bool SetPosition(uint8_t position_index);

  gpio_num_t servo_pin_;
  bool initialized_;
};

}  // namespace listener