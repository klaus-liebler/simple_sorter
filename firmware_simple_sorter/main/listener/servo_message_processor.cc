#include "esp_log.h"
#include "listener/servo_message_processor.hh"

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

static constexpr uint8_t kWiggleMin = 128 - 30;
static constexpr uint8_t kWiggleMax = 128 + 30;
static constexpr uint32_t kWiggleIntervalMs = 150;
static constexpr char kServoLogTag[] = "ServoMessageProcessor";

static uint32_t PositionToPulseUs(uint8_t position_index) {
  uint32_t const span = kServoPulseMaxUs - kServoPulseMinUs;
  return kServoPulseMinUs + (span * position_index) / UINT8_MAX;
}

static uint32_t PulseUsToDuty(uint32_t pulse_us) {
  uint32_t const max_duty = (1u << kLedcResolution) - 1u;
  return (max_duty * pulse_us) / kServoPeriodUs;
}

}  // namespace

ServoMessageProcessor::ServoMessageProcessor(gpio_num_t servo_pin)
  : servo_pin_(servo_pin) {
}

void ServoMessageProcessor::Handle(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload) {
  if (payload == nullptr) {
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
}

void ServoMessageProcessor::HandleSetPosition(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload) {
  (void)context; (void)message_id;
  currentDynamicPosition = eDynamicPosition::NO_DYNAMICS;
  currentPosition = payload[0];
  wiggle_next_ms_ = 0;
  ESP_LOGI(kServoLogTag, "SetPosition message: static_pos=%u, mode=NO_DYNAMICS", currentPosition);
}

void ServoMessageProcessor::HandleDynamicMessage(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload) {
  (void)context; (void)message_id;
  eDynamicPosition const previous_position = currentDynamicPosition;
  eDynamicPosition const position = static_cast<eDynamicPosition>(payload[0]);
  ESP_LOGI(kServoLogTag, "Dynamic message received: prev=%u new=%u", static_cast<unsigned>(previous_position), static_cast<unsigned>(position));

  if (position == eDynamicPosition::MIDDLE && previous_position != eDynamicPosition::MIDDLE) {
    wiggle_pos_     = kWiggleMin;
    wiggle_next_ms_ = 0;
    ESP_LOGI(kServoLogTag, "Wiggle armed: pos=%u interval=%lu", wiggle_pos_, static_cast<unsigned long>(kWiggleIntervalMs));
  }
  currentDynamicPosition = position;
}

void ServoMessageProcessor::Loop(ISendBackInterface& context, uint32_t now_ms) {
  (void)context;
  switch (currentDynamicPosition) {
  case eDynamicPosition::NO_DYNAMICS:
    SetPosition(currentPosition);
    break;
  case eDynamicPosition::RIGHT:
    SetPosition(0);
    break;
  case eDynamicPosition::MIDDLE:
    if (wiggle_next_ms_ == 0) {
      SetPosition(wiggle_pos_);
      wiggle_next_ms_ = now_ms + kWiggleIntervalMs;
      break;
    }
    if (static_cast<int32_t>(now_ms - wiggle_next_ms_) >= 0) {
      wiggle_pos_ = (wiggle_pos_ == kWiggleMin) ? kWiggleMax : kWiggleMin;
      SetPosition(wiggle_pos_);
      wiggle_next_ms_ += kWiggleIntervalMs;
    }
    break;
  case eDynamicPosition::LEFT:
    SetPosition(255);
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