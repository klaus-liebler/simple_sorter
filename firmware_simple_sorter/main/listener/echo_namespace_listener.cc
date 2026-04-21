#include "listener/echo_namespace_listener.hh"

namespace listener {

void EchoNamespaceListener::Handle(ISendBackInterface& context, uint16_t message_id, const uint8_t* payload) {
  (void)context.Send(kNamespaceEcho, message_id, payload);
}

}  // namespace listener