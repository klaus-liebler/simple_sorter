#pragma once

#include "listener/interfaces.hh"

namespace listener {

class EchoNamespaceListener final : public INamespaceListener {
public:
  static constexpr uint16_t kNamespaceEcho = 0x0001;

  void Handle(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload) override;
};

}  // namespace listener