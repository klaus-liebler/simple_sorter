#pragma once

#include <stdint.h>

namespace listener {

class ISendBackInterface {
public:
  virtual ~ISendBackInterface() = default;
  virtual bool Send(uint16_t name_space, uint16_t message_id, const uint8_t* payload) = 0;
};

class INamespaceListener {
public:
  virtual ~INamespaceListener() = default;
  virtual void Handle(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload) = 0;
};

}  // namespace listener