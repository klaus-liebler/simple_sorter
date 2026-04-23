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

  enum class eDynamicMode {
    NO_DYNAMICS   = 0,
    RIGHT  = 1,
    WIGGLE = 2,
    LEFT   = 3,
  };
  enum class eDropSequencePhase {
    IDLE = 0,
    RAMP_TO_TARGET = 1,
    HOLD_AT_TARGET = 2,
    RAMP_BACK = 3,
  };

  eDynamicMode currentDynamicMode = eDynamicMode::NO_DYNAMICS;
  uint8_t currentPosition = 128;
  uint8_t appliedPosition_ = 0;

  uint8_t  wiggle_pos_     = 60;
  uint32_t wiggle_next_ms_ = 0;
  uint32_t last_dynamic_mode_set_ms= 0;

  bool command_lock_active_ = false;
  bool has_applied_position_ = false;
  eDropSequencePhase drop_sequence_phase_ = eDropSequencePhase::IDLE;
  uint8_t drop_start_position_ = 128;
  uint8_t drop_target_position_ = 128;
  uint32_t drop_phase_start_ms_ = 0;

  void SetPosition(uint8_t position);
  void ArmWiggle(uint32_t now_ms);
  void StartDropSequence(eDynamicMode mode, uint32_t now_ms);
  void UpdateDropSequence(uint32_t now_ms);
  void HandleSetPosition(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload);
  void HandleDynamicMessage(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload);
  void Loop(ISendBackInterface& context, uint32_t now_ms) override;
};

}  // namespace listener