import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./styles.css";
import "./connect-panel.js";
import "./rgb-color-wheel.js";
import "./sorter-panel.js";
import { UsbService } from "./usb.js";

export interface IMessageSender {
	send(namespaceId: number, messageId: number, payload: Uint8Array): Promise<void>;
}

@customElement("my-app")
export class Application extends LitElement {
	protected createRenderRoot() {
		return this;
	}

	@state() protected accessor deviceConnected = false;
	@state() protected accessor statusMessage = "Not connected";

	private readonly usb = new UsbService(({ deviceConnected, statusMessage }) => {
		this.deviceConnected = deviceConnected;
		this.statusMessage = statusMessage;
	});

	private readonly messageSender: IMessageSender = {
		send: async (namespaceId: number, messageId: number, payload: Uint8Array) => {
			try {
				await this.usb.send(namespaceId, messageId, payload);
			} catch (error) {
				alert(error instanceof Error ? error.message : String(error));
			}
		}
	};

	private requestDevice = async () => {
		await this.usb.requestDevice();
	};

	private disconnectDevice = async () => {
		await this.usb.disconnectDevice();
	};

	render() {
		return html`
			<div class="container">
				<div class="header-section">
					<connect-panel
						.deviceConnected=${this.deviceConnected}
						.statusMessage="${this.statusMessage}"
						@request-device="${this.requestDevice}"
						@disconnect-device="${this.disconnectDevice}"
					></connect-panel>
				</div>

				<div class="header-section">
					<sorter-panel
						.deviceConnected=${this.deviceConnected}
						.messageSender=${this.messageSender}
					></sorter-panel>
				</div>

				<div class="content-section">
					<rgb-color-wheel
						.deviceConnected=${this.deviceConnected}
						.messageSender=${this.messageSender}
					></rgb-color-wheel>
				</div>
			</div>
		`;
	}
}