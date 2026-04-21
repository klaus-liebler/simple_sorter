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
static constexpr uint8_t kServoMinPosition = 0;
static constexpr uint8_t kServoMaxPosition = 25;
static constexpr uint32_t kServoPulseMinUs = 1000;
static constexpr uint32_t kServoPulseMaxUs = 2000;
static constexpr uint32_t kServoPeriodUs = 20000;

static uint32_t PositionToPulseUs(uint8_t position_index) {
  uint32_t const span = kServoPulseMaxUs - kServoPulseMinUs;
  return kServoPulseMinUs + (span * position_index) / kServoMaxPosition;
}

static uint32_t PulseUsToDuty(uint32_t pulse_us) {
  uint32_t const max_duty = (1u << kLedcResolution) - 1u;
  return (max_duty * pulse_us) / kServoPeriodUs;
}

}  // namespace

ServoMessageProcessor::ServoMessageProcessor(gpio_num_t servo_pin)
  : servo_pin_(servo_pin),
    initialized_(false) {
}

bool ServoMessageProcessor::Begin() {
  ledc_timer_config_t timer_config = {};
  timer_config.speed_mode = kLedcSpeedMode;
  timer_config.duty_resolution = kLedcResolution;
  timer_config.timer_num = kLedcTimer;
  timer_config.freq_hz = kLedcFrequencyHz;
  timer_config.clk_cfg = LEDC_AUTO_CLK;
  if (ledc_timer_config(&timer_config) != ESP_OK) {
    return false;
  }

  ledc_channel_config_t channel_config = {};
  channel_config.gpio_num = servo_pin_;
  channel_config.speed_mode = kLedcSpeedMode;
  channel_config.channel = kLedcChannel;
  channel_config.timer_sel = kLedcTimer;
  channel_config.duty = PulseUsToDuty(kServoPulseMinUs);
  channel_config.hpoint = 0;
  if (ledc_channel_config(&channel_config) != ESP_OK) {
    return false;
  }

  initialized_ = true;
  return true;
}

void ServoMessageProcessor::Handle(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload) {
  (void)context;
  (void)message_id;

  if (!initialized_ || payload == nullptr) {
    return;
  }

  uint8_t position_index = payload[0];
  if (position_index < kServoMinPosition) {
    position_index = kServoMinPosition;
  }
  if (position_index > kServoMaxPosition) {
    position_index = kServoMaxPosition;
  }

  (void)SetPosition(position_index);
}

bool ServoMessageProcessor::SetPosition(uint8_t position_index) {
  uint32_t const pulse_us = PositionToPulseUs(position_index);
  uint32_t const duty = PulseUsToDuty(pulse_us);
  ESP_LOGI("ServoMessageProcessor", "Set servo position to index %u (pulse %u us, duty %u)", position_index, pulse_us, duty);

  if (ledc_set_duty(kLedcSpeedMode, kLedcChannel, duty) != ESP_OK) {
    return false;
  }

  return ledc_update_duty(kLedcSpeedMode, kLedcChannel) == ESP_OK;
}

}  // namespace listener