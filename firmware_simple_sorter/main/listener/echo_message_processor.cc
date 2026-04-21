#include "listener/echo_message_processor.hh"

namespace listener {

void EchoMessageProcessor::Handle(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload) {
  (void)context.Send(kNamespaceEcho, message_id, payload);
}

uint16_t EchoMessageProcessor::GetNamespace() const {
  return kNamespaceEcho;
}

}  // namespace listener