import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import "./styles.css";
import "./connect-panel.js";
import "./rgb-color-wheel-panel.js";
import "./sorter-panel.js";
import { UsbService } from "./usb.js";
import hsos_logo from "./hsos_logo.svg?raw";

export interface IMessageSender {
	send(namespaceId: number, messageId: number, payload: Uint8Array): Promise<void>;
}

@customElement("my-app")
export class Application extends LitElement {
	private static readonly STATUS_NOT_CONNECTED = "Noch nicht verbunden. Bitte auf die Schaltfläche \"Verbinden\" klicken";
	private static readonly STATUS_CONNECTED = "Verbindung erfolgreich hergestellt";
	private static readonly STATUS_PROBLEM = "Verbindungsproblem! Hole Dir gerne Hilfe!";

	protected createRenderRoot() {
		return this;
	}

	@state() protected accessor deviceConnected = false;
	@state() protected accessor statusMessage = Application.STATUS_NOT_CONNECTED;
	@state() protected accessor statusVariant: "warning" | "success" | "error" = "warning";

	private readonly usb = new UsbService(({ deviceConnected, statusMessage }) => {
		this.deviceConnected = deviceConnected;
		const normalizedStatus = statusMessage.toLowerCase();
		const isProblem = /failed|error|cancelled|problem/.test(normalizedStatus);

		if (deviceConnected) {
			this.statusVariant = "success";
			this.statusMessage = Application.STATUS_CONNECTED;
			return;
		}

		if (isProblem) {
			this.statusVariant = "error";
			this.statusMessage = Application.STATUS_PROBLEM;
			return;
		}

		this.statusVariant = "warning";
		this.statusMessage = Application.STATUS_NOT_CONNECTED;
	});

	private readonly messageSender: IMessageSender = {
		send: async (namespaceId: number, messageId: number, payload: Uint8Array) => {
			try {
				await this.usb.send(namespaceId, messageId, payload);
			} catch (error) {
				console.error("Senden fehlgeschlagen", error);
				alert("Senden fehlgeschlagen. Bitte Verbindung prüfen.");
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
				<section class="logo-section">
					<div class="hsos-logo" aria-label="HSOS-Logo">${unsafeHTML(hsos_logo)}</div>
				</section>

				<section class="header-section">
					<connect-panel
						.deviceConnected=${this.deviceConnected}
						.statusVariant=${this.statusVariant}
						.statusMessage="${this.statusMessage}"
						@request-device="${this.requestDevice}"
						@disconnect-device="${this.disconnectDevice}"
					></connect-panel>
				</section>

				${this.deviceConnected
					? html`
						<section class="header-section">
							<sorter-panel
								.deviceConnected=${this.deviceConnected}
								.messageSender=${this.messageSender}
							></sorter-panel>
						</section>

						<section class="header-section">
							<rgb-color-wheel-panel
								.deviceConnected=${this.deviceConnected}
								.messageSender=${this.messageSender}
							></rgb-color-wheel-panel>
						</section>
					`
					: null}
			</div>
		`;
	}
}