#include "esp_log.h"
#include "listener/servo_message_processor.hh"
#include "esp_timer.h"
#include "driver/ledc.h"

namespace listener
{

  namespace
  {

    static constexpr ledc_mode_t kLedcSpeedMode = LEDC_LOW_SPEED_MODE;
    static constexpr ledc_timer_t kLedcTimer = LEDC_TIMER_0;
    static constexpr ledc_channel_t kLedcChannel = LEDC_CHANNEL_0;
    static constexpr ledc_timer_bit_t kLedcResolution = LEDC_TIMER_14_BIT;
    
    static constexpr uint32_t kLedcFrequencyHz = 50;
    static constexpr uint32_t kServoPulseMinUs = 500;   // SG90: -90 degrees
    static constexpr uint32_t kServoPulseMaxUs = 2500;  // SG90: +90 degrees
    static constexpr uint32_t kServoPeriodUs = 20000;

    static constexpr char kServoLogTag[] = "ServoMessageProcessor";

    static uint16_t DecodeU16Le(uint8_t const *payload)
    {
      return static_cast<uint16_t>(payload[0]) |
             (static_cast<uint16_t>(payload[1]) << 8);
    }

    static uint32_t PositionToPulseUs(uint8_t position_index)
    {
      uint32_t const span = kServoPulseMaxUs - kServoPulseMinUs;
      return kServoPulseMinUs + (span * position_index) / UINT8_MAX;
    }

    static uint32_t PulseUsToDuty(uint32_t pulse_us)
    {
      uint32_t const max_duty = (1u << kLedcResolution) - 1u;
      return (max_duty * pulse_us) / kServoPeriodUs;
    }

    static uint8_t InterpolatePosition(uint8_t from, uint8_t to, uint32_t elapsed_ms, uint32_t duration_ms)
    {
      if (duration_ms == 0 || elapsed_ms >= duration_ms)
      {
        return to;
      }
      int32_t const delta = static_cast<int32_t>(to) - static_cast<int32_t>(from);
      int32_t const step = (delta * static_cast<int32_t>(elapsed_ms)) / static_cast<int32_t>(duration_ms);
      return static_cast<uint8_t>(static_cast<int32_t>(from) + step);
    }

    static uint32_t CalculateMoveDurationMs(uint8_t from, uint8_t to, uint32_t time_for_180_ms)
    {
      if (time_for_180_ms == 0 || from == to)
      {
        return 0;
      }

      uint32_t const delta = (from > to) ? (from - to) : (to - from);
      uint64_t const scaled = static_cast<uint64_t>(time_for_180_ms) * static_cast<uint64_t>(delta);
      uint32_t const duration = static_cast<uint32_t>((scaled + (UINT8_MAX / 2)) / UINT8_MAX);
      return (duration == 0) ? 1 : duration;
    }

  } // namespace

  ServoMessageProcessor::ServoMessageProcessor(gpio_num_t servo_pin)
      : servo_pin_(servo_pin)
  {
  }

  void ServoMessageProcessor::Handle(ISendBackInterface &context, uint16_t message_id, const uint8_t *payload)
  {
    if (payload == nullptr)
    {
      return;
    }
    switch (message_id)
    {
    case 0x0001:
      HandleSetPosition(context, message_id, payload);
      break;
    case 0x0002:
      HandleWiggle(context, message_id, payload);
      break;
    default:
      break;
    }
  }

  uint16_t ServoMessageProcessor::GetNamespace() const
  {
    return kNamespaceServo;
  }

  void ServoMessageProcessor::SetPosition(uint8_t position)
  {
    if (appliedPosition_ == position)
    {
      return;
    }

    uint32_t const pulse_us = PositionToPulseUs(position);
    uint32_t const duty = PulseUsToDuty(pulse_us);
    if (ledc_set_duty(kLedcSpeedMode, kLedcChannel, duty) != ESP_OK)
    {
      return;
    }
    ledc_update_duty(kLedcSpeedMode, kLedcChannel);
    appliedPosition_ = position;
    has_applied_position_ = true;
  }

  void ServoMessageProcessor::StartMoveTo(uint8_t target_position, uint32_t time_for_180_ms, uint32_t now_ms)
  {
    uint8_t const start_position = has_applied_position_ ? appliedPosition_ : set_position_target_;
    move_start_position_ = start_position;
    move_target_position_ = target_position;
    move_time_for_180_ms_ = time_for_180_ms;
    move_start_ms_ = now_ms;
    move_duration_ms_ = CalculateMoveDurationMs(start_position, target_position, time_for_180_ms);
    move_active_ = (move_duration_ms_ > 0);

    if (!move_active_)
    {
      SetPosition(target_position);
    }
  }

  bool ServoMessageProcessor::UpdateMove(uint32_t now_ms)
  {
    if (!move_active_)
    {
      return false;
    }

    uint32_t const elapsed_ms = now_ms - move_start_ms_;
    if (elapsed_ms >= move_duration_ms_)
    {
      SetPosition(move_target_position_);
      move_active_ = false;
      return false;
    }

    SetPosition(InterpolatePosition(move_start_position_, move_target_position_, elapsed_ms, move_duration_ms_));
    return true;
  }

  void ServoMessageProcessor::ArmWiggle(uint8_t wiggle_min, uint8_t wiggle_max, uint32_t time_for_180_ms, uint32_t now_ms)
  {
    if (wiggle_max < wiggle_min)
    {
      uint8_t const tmp = wiggle_min;
      wiggle_min = wiggle_max;
      wiggle_max = tmp;
    }

    wiggle_min_ = wiggle_min;
    wiggle_max_ = wiggle_max;
    wiggle_time_for_180_ms_ = time_for_180_ms;
    current_mode_ = eMode::WIGGLE;

    StartMoveTo(wiggle_min_, wiggle_time_for_180_ms_, now_ms);
    wiggle_next_target_ = wiggle_max_;
    wiggle_next_ms_ = now_ms + ((move_duration_ms_ == 0) ? 1 : move_duration_ms_);

    ESP_LOGI(
        kServoLogTag,
        "Wiggle armed: min=%u max=%u time180=%lu",
        static_cast<unsigned>(wiggle_min_),
        static_cast<unsigned>(wiggle_max_),
        static_cast<unsigned long>(wiggle_time_for_180_ms_));
  }

  void ServoMessageProcessor::HandleSetPosition(ISendBackInterface &context, uint16_t message_id, const uint8_t *payload)
  {
    (void)context;
    (void)message_id;

    uint8_t const position = payload[0];
    uint32_t const time_for_180_ms = DecodeU16Le(payload + 1);
    uint32_t const now_ms = static_cast<uint32_t>(esp_timer_get_time() / 1000);

    current_mode_ = eMode::SET_POSITION;
    set_position_target_ = position;
    move_time_for_180_ms_ = time_for_180_ms;
    wiggle_next_ms_ = 0;
    StartMoveTo(set_position_target_, move_time_for_180_ms_, now_ms);

    ESP_LOGI(
        kServoLogTag,
        "SetPosition message: position=%u time180=%lu",
        static_cast<unsigned>(set_position_target_),
        static_cast<unsigned long>(move_time_for_180_ms_));
  }

  void ServoMessageProcessor::HandleWiggle(ISendBackInterface &context, uint16_t message_id, const uint8_t *payload)
  {
    (void)context;
    (void)message_id;
    uint8_t const wiggle_min = payload[0];
    uint8_t const wiggle_max = payload[1];
    uint32_t const time_for_180_ms = DecodeU16Le(payload + 2);
    uint32_t const now_ms = static_cast<uint32_t>(esp_timer_get_time() / 1000);

    ArmWiggle(wiggle_min, wiggle_max, time_for_180_ms, now_ms);
  }

  void ServoMessageProcessor::Loop(ISendBackInterface &context, uint32_t now_ms)
  {
    (void)context;

    switch (current_mode_)
    {
    case eMode::SET_POSITION:
      if (!UpdateMove(now_ms))
      {
        SetPosition(set_position_target_);
      }
      break;
    case eMode::WIGGLE:
      if (!UpdateMove(now_ms) && static_cast<int32_t>(now_ms - wiggle_next_ms_) >= 0)
      {
        StartMoveTo(wiggle_next_target_, wiggle_time_for_180_ms_, now_ms);
        wiggle_next_ms_ = now_ms + ((move_duration_ms_ == 0) ? 1 : move_duration_ms_);
        wiggle_next_target_ = (wiggle_next_target_ == wiggle_min_) ? wiggle_max_ : wiggle_min_;
      }
      break;
    default:
      break;
    }
  }

  void ServoMessageProcessor::Setup(ISendBackInterface &context, uint32_t now_ms)
  {
    (void)context;
    (void)now_ms;

    ledc_timer_config_t timer_config = {};
    timer_config.speed_mode = kLedcSpeedMode;
    timer_config.duty_resolution = kLedcResolution;
    timer_config.timer_num = kLedcTimer;
    timer_config.freq_hz = kLedcFrequencyHz;
    timer_config.clk_cfg = LEDC_AUTO_CLK;
    if (ledc_timer_config(&timer_config) != ESP_OK)
    {
      return;
    }

    ledc_channel_config_t channel_config = {};
    channel_config.gpio_num = servo_pin_;
    channel_config.speed_mode = kLedcSpeedMode;
    channel_config.channel = kLedcChannel;
    channel_config.timer_sel = kLedcTimer;
    channel_config.duty = PulseUsToDuty(kServoPulseMinUs);
    channel_config.hpoint = 0;
    if (ledc_channel_config(&channel_config) != ESP_OK)
    {
      return;
    }
    SetPosition(set_position_target_);

    return;
  }
}