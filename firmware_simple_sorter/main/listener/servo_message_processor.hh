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

  enum class eMode {
    SET_POSITION = 0,
    WIGGLE = 1,
  };

  eMode current_mode_ = eMode::SET_POSITION;
  uint8_t set_position_target_ = 128;
  uint8_t appliedPosition_ = 0;
  uint32_t move_time_for_180_ms_ = 0;

  uint8_t wiggle_min_ = 60;
  uint8_t wiggle_max_ = 60;
  uint8_t wiggle_next_target_ = 60;
  uint32_t wiggle_time_for_180_ms_ = 0;
  uint32_t wiggle_next_ms_ = 0;
  bool has_applied_position_ = false;

  bool move_active_ = false;
  uint8_t move_start_position_ = 128;
  uint8_t move_target_position_ = 128;
  uint32_t move_start_ms_ = 0;
  uint32_t move_duration_ms_ = 0;

  void SetPosition(uint8_t position);
  void StartMoveTo(uint8_t target_position, uint32_t time_for_180_ms, uint32_t now_ms);
  bool UpdateMove(uint32_t now_ms);
  void ArmWiggle(uint8_t wiggle_min, uint8_t wiggle_max, uint32_t time_for_180_ms, uint32_t now_ms);
  void HandleSetPosition(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload);
  void HandleWiggle(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload);
  void Loop(ISendBackInterface& context, uint32_t now_ms) override;
};

}  // namespace listener