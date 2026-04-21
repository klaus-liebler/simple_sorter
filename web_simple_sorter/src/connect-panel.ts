import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("connect-panel")
export class ConnectPanel extends LitElement {
	protected createRenderRoot() {
		return this;
	}

	@property({ type: Boolean }) accessor deviceConnected = false;
	@property() accessor statusMessage = "Not connected";

	private handleConnect() {
		this.dispatchEvent(new CustomEvent("request-device"));
	}

	private handleDisconnect() {
		this.dispatchEvent(new CustomEvent("disconnect-device"));
	}

	render() {
		return html`
			<div class="panel">
				<div class="status">
					<div class="status-label">Status</div>
					<div
						class="status-text ${this.deviceConnected
							? "device-connected"
							: "device-disconnected"}"
					>
						${this.statusMessage}
					</div>
				</div>
				<div class="buttons">
					<button
						class="connect-btn"
						@click="${this.handleConnect}"
						?hidden="${this.deviceConnected}"
					>
						Connect
					</button>
					<button
						class="disconnect-btn"
						@click="${this.handleDisconnect}"
						?hidden="${!this.deviceConnected}"
					>
						Disconnect
					</button>
				</div>
			</div>
		`;
	}
}
