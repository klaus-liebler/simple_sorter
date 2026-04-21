#pragma once

#include <stdint.h>



class ISendBackInterface {
public:
  virtual ~ISendBackInterface() = default;
  virtual bool Send(uint16_t name_space, uint16_t message_id, const uint8_t* payload) = 0;
};

class IMessageProcessor {
public:
  virtual ~IMessageProcessor() = default;
  virtual void Handle(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload) = 0;
  virtual uint16_t GetNamespace() const = 0;
  virtual void Setup(ISendBackInterface& context, uint32_t now_ms) {}
  virtual void Loop(ISendBackInterface& context, uint32_t now_ms) {}
};
