import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("connect-panel")
export class ConnectPanel extends LitElement {
	static styles = [
		css`
			:host {
				display: block;
			}
			.panel {
				display: flex;
				justify-content: space-between;
				align-items: center;
				gap: 20px;
			}
			.status {
				flex: 1;
			}
			.status-label {
				font-size: 12px;
				text-transform: uppercase;
				letter-spacing: 1px;
				color: #666;
				margin-bottom: 4px;
			}
			.status-text {
				font-size: 16px;
				font-weight: 500;
				color: #333;
			}
			.status-text.connected {
				color: #2ecc71;
			}
			.status-text.disconnected {
				color: #e74c3c;
			}
			.buttons {
				display: flex;
				gap: 10px;
			}
			button {
				padding: 10px 20px;
				font-size: 14px;
				border: none;
				border-radius: 4px;
				cursor: pointer;
				font-weight: 600;
				transition: all 0.3s ease;
			}
			.connect-btn {
				background-color: #3498db;
				color: white;
			}
			.connect-btn:hover {
				background-color: #2980b9;
			}
			.disconnect-btn {
				background-color: #e74c3c;
				color: white;
			}
			.disconnect-btn:hover {
				background-color: #c0392b;
			}
			.disconnect-btn:disabled {
				background-color: #bdc3c7;
				cursor: not-allowed;
			}
		`
	];

	@property() accessor isConnected = false;
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
						class="status-text ${this.isConnected
							? "connected"
							: "disconnected"}"
					>
						${this.statusMessage}
					</div>
				</div>
				<div class="buttons">
					<button
						class="connect-btn"
						@click="${this.handleConnect}"
						?hidden="${this.isConnected}"
					>
						Connect
					</button>
					<button
						class="disconnect-btn"
						@click="${this.handleDisconnect}"
						?hidden="${!this.isConnected}"
					>
						Disconnect
					</button>
				</div>
			</div>
		`;
	}
}
