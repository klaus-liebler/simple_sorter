#include "esp_log.h"
#include "listener/servo_message_processor.hh"
#include "esp_timer.h"
#include "driver/ledc.h"

namespace listener {

namespace {

static constexpr ledc_mode_t kLedcSpeedMode = LEDC_LOW_SPEED_MODE;
static constexpr ledc_timer_t kLedcTimer = LEDC_TIMER_0;
static constexpr ledc_channel_t kLedcChannel = LEDC_CHANNEL_0;
static constexpr ledc_timer_bit_t kLedcResolution = LEDC_TIMER_14_BIT;
static constexpr uint32_t kLedcFrequencyHz = 50;
static constexpr uint32_t kServoPulseMinUs = 1000;
static constexpr uint32_t kServoPulseMaxUs = 2000;
static constexpr uint32_t kServoPeriodUs = 20000;

static constexpr uint8_t kWiggleMin = 75*256/180;  // 75 degrees in 0-255 range
static constexpr uint8_t kWiggleMax = 105*256/180; // 105 degrees in 0-255 range
static constexpr uint32_t kWiggleIntervalMs = 100;
static constexpr uint32_t kDropRampDurationMs = 700;
static constexpr uint32_t kDropHoldDurationMs = 1000;
static constexpr char kServoLogTag[] = "ServoMessageProcessor";

static uint32_t PositionToPulseUs(uint8_t position_index) {
  uint32_t const span = kServoPulseMaxUs - kServoPulseMinUs;
  return kServoPulseMinUs + (span * position_index) / UINT8_MAX;
}

static uint32_t PulseUsToDuty(uint32_t pulse_us) {
  uint32_t const max_duty = (1u << kLedcResolution) - 1u;
  return (max_duty * pulse_us) / kServoPeriodUs;
}

static uint8_t InterpolatePosition(uint8_t from, uint8_t to, uint32_t elapsed_ms, uint32_t duration_ms) {
  if (duration_ms == 0 || elapsed_ms >= duration_ms) {
    return to;
  }
  int32_t const delta = static_cast<int32_t>(to) - static_cast<int32_t>(from);
  int32_t const step = (delta * static_cast<int32_t>(elapsed_ms)) / static_cast<int32_t>(duration_ms);
  return static_cast<uint8_t>(static_cast<int32_t>(from) + step);
}

}  // namespace

ServoMessageProcessor::ServoMessageProcessor(gpio_num_t servo_pin)
  : servo_pin_(servo_pin) {
}

void ServoMessageProcessor::Handle(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload) {
  if (payload == nullptr) {
    return;
  }
  if (command_lock_active_) {
    return;
  }
  switch (message_id) {
  case 0x0001:
    HandleSetPosition(context, message_id, payload);
    break;
  case 0x0002:
    HandleDynamicMessage(context, message_id, payload);
    break;
  default:
    break;
  }
}

uint16_t ServoMessageProcessor::GetNamespace() const {
  return kNamespaceServo;
}

void ServoMessageProcessor::SetPosition(uint8_t position) {
  if (appliedPosition_ == position) {
    return;
  }

  uint32_t const pulse_us = PositionToPulseUs(position);
  uint32_t const duty = PulseUsToDuty(pulse_us);
  if (ledc_set_duty(kLedcSpeedMode, kLedcChannel, duty) != ESP_OK) {
    return;
  }
  ledc_update_duty(kLedcSpeedMode, kLedcChannel);
  appliedPosition_ = position;
  has_applied_position_ = true;
}

void ServoMessageProcessor::ArmWiggle(uint32_t now_ms) {
  wiggle_pos_ = kWiggleMin;
  wiggle_next_ms_ = now_ms;
  currentDynamicMode = eDynamicMode::WIGGLE;
}

void ServoMessageProcessor::StartDropSequence(eDynamicMode mode, uint32_t now_ms) {
  drop_start_position_ = has_applied_position_ ? appliedPosition_ : currentPosition;
  drop_target_position_ = (mode == eDynamicMode::RIGHT) ? 0 : 255;
  drop_phase_start_ms_ = now_ms;
  drop_sequence_phase_ = eDropSequencePhase::RAMP_TO_TARGET;
  command_lock_active_ = true;
  currentDynamicMode = mode;

  ESP_LOGI(
    kServoLogTag,
    "Drop sequence started: mode=%u from=%u to=%u",
    static_cast<unsigned>(mode),
    static_cast<unsigned>(drop_start_position_),
    static_cast<unsigned>(drop_target_position_));
}

void ServoMessageProcessor::UpdateDropSequence(uint32_t now_ms) {
  uint32_t const elapsed_ms = now_ms - drop_phase_start_ms_;

  switch (drop_sequence_phase_) {
  case eDropSequencePhase::RAMP_TO_TARGET:
    SetPosition(InterpolatePosition(drop_start_position_, drop_target_position_, elapsed_ms, kDropRampDurationMs));
    if (elapsed_ms >= kDropRampDurationMs) {
      drop_sequence_phase_ = eDropSequencePhase::HOLD_AT_TARGET;
      drop_phase_start_ms_ = now_ms;
    }
    break;
  case eDropSequencePhase::HOLD_AT_TARGET:
    SetPosition(drop_target_position_);
    if (elapsed_ms >= kDropHoldDurationMs) {
      drop_sequence_phase_ = eDropSequencePhase::RAMP_BACK;
      drop_phase_start_ms_ = now_ms;
    }
    break;
  case eDropSequencePhase::RAMP_BACK:
    SetPosition(InterpolatePosition(drop_target_position_, drop_start_position_, elapsed_ms, kDropRampDurationMs));
    if (elapsed_ms >= kDropRampDurationMs) {
      SetPosition(drop_start_position_);
      command_lock_active_ = false;
      drop_sequence_phase_ = eDropSequencePhase::IDLE;
      ArmWiggle(now_ms);
      ESP_LOGI(kServoLogTag, "Drop sequence complete, switching to WIGGLE");
    }
    break;
  case eDropSequencePhase::IDLE:
  default:
    break;
  }
}

void ServoMessageProcessor::HandleSetPosition(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload) {
  (void)context; (void)message_id;
  currentDynamicMode = eDynamicMode::NO_DYNAMICS;
  currentPosition = payload[0];
  wiggle_next_ms_ = 0;
  ESP_LOGI(kServoLogTag, "SetPosition message: static_pos=%u, mode=NO_DYNAMICS", currentPosition);
}

void ServoMessageProcessor::HandleDynamicMessage(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload) {
  (void)context; (void)message_id;
  uint32_t now = static_cast<uint32_t>(esp_timer_get_time() / 1000);
  eDynamicMode const next_dynamic_mode = static_cast<eDynamicMode>(payload[0]);
  ESP_LOGI(kServoLogTag, "Dynamic message received: prev=%u new=%u", static_cast<unsigned>(currentPosition), static_cast<unsigned>(next_dynamic_mode));

  if (next_dynamic_mode == eDynamicMode::RIGHT || next_dynamic_mode == eDynamicMode::LEFT) {
    StartDropSequence(next_dynamic_mode, now);
    last_dynamic_mode_set_ms = now;
    return;
  }

  if (next_dynamic_mode == eDynamicMode::WIGGLE && currentDynamicMode != eDynamicMode::WIGGLE) {
    ArmWiggle(now);
    ESP_LOGI(kServoLogTag, "Wiggle armed: pos=%u interval=%lu", wiggle_pos_, static_cast<unsigned long>(kWiggleIntervalMs));
  }

  currentDynamicMode = next_dynamic_mode;
  last_dynamic_mode_set_ms = now;
}

void ServoMessageProcessor::Loop(ISendBackInterface& context, uint32_t now_ms) {
  (void)context;

  if (command_lock_active_) {
    UpdateDropSequence(now_ms);
    return;
  }

  switch (currentDynamicMode) {
  case eDynamicMode::NO_DYNAMICS:
    SetPosition(currentPosition);
    break;
  case eDynamicMode::RIGHT:
    StartDropSequence(eDynamicMode::RIGHT, now_ms);
    break;
  case eDynamicMode::WIGGLE:
    if (static_cast<int32_t>(now_ms - wiggle_next_ms_) >= 0) {
      wiggle_pos_ = (wiggle_pos_ == kWiggleMin) ? kWiggleMax : kWiggleMin;
      SetPosition(wiggle_pos_);
      wiggle_next_ms_ = now_ms + kWiggleIntervalMs;
    }
    break;
  case eDynamicMode::LEFT:
    StartDropSequence(eDynamicMode::LEFT, now_ms);
    break;
  default:
    break;
  }
}

void ServoMessageProcessor::Setup(ISendBackInterface& context, uint32_t now_ms) {
  (void)context;
  (void)now_ms;

  ledc_timer_config_t timer_config = {};
  timer_config.speed_mode = kLedcSpeedMode;
  timer_config.duty_resolution = kLedcResolution;
  timer_config.timer_num = kLedcTimer;
  timer_config.freq_hz = kLedcFrequencyHz;
  timer_config.clk_cfg = LEDC_AUTO_CLK;
  if (ledc_timer_config(&timer_config) != ESP_OK) {
    return;
  }

  ledc_channel_config_t channel_config = {};
  channel_config.gpio_num = servo_pin_;
  channel_config.speed_mode = kLedcSpeedMode;
  channel_config.channel = kLedcChannel;
  channel_config.timer_sel = kLedcTimer;
  channel_config.duty = PulseUsToDuty(kServoPulseMinUs);
  channel_config.hpoint = 0;
  if (ledc_channel_config(&channel_config) != ESP_OK) {
    return;
  }
  SetPosition(currentPosition);

  return;
}





}  // namespace listener