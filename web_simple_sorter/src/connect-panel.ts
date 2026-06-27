import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("connect-panel")
export class ConnectPanel extends LitElement {
	protected createRenderRoot() {
		return this;
	}

	@property({ type: Boolean }) accessor deviceConnected = false;
	@property() accessor statusMessage = "Noch nicht verbunden. Bitte auf die Schaltfläche \"Verbinden\" klicken";
	@property() accessor statusVariant: "warning" | "success" | "error" = "warning";

	private handleConnect() {
		this.dispatchEvent(new CustomEvent("request-device"));
	}

	private handleDisconnect() {
		this.dispatchEvent(new CustomEvent("disconnect-device"));
	}

	render() {
		return html`
			<div class="panel app-panel">
				<div class="status">
					<div class="status-label">Verbindungsstatus</div>
					<div
						class="status-text ${this.statusVariant === "success"
							? "status-success"
							: this.statusVariant === "error"
								? "status-error"
								: "status-warning"}"
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
						Verbinden
					</button>
					<button
						class="disconnect-btn"
						@click="${this.handleDisconnect}"
						?hidden="${!this.deviceConnected}"
					>
						Trennen
					</button>
				</div>
			</div>
		`;
	}
}
