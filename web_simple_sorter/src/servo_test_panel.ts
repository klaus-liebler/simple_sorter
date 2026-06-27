import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { IMessageSender } from "./app.js";

@customElement("servo-test-panel")
export class ServoTestPanel extends LitElement {
	protected createRenderRoot() {
		return this;
	}

	@property({ type: Boolean }) accessor deviceConnected = false;
	@property() accessor messageSender: IMessageSender | undefined;

	@state() private accessor servoU8 = 128;
	@state() private accessor wiggleMinU8 = 113;
	@state() private accessor wiggleMaxU8 = 142;
	@state() private accessor timeFor180Ms = 700;

	private encodeU16Le(value: number) {
		const clamped = Math.max(0, Math.min(0xffff, Math.round(value)));
		return [clamped & 0xff, (clamped >> 8) & 0xff];
	}

	private sendSetPosition(position: number) {
		const payload = new Uint8Array([
			Math.max(0, Math.min(255, Math.round(position))),
			...this.encodeU16Le(this.timeFor180Ms),
		]);
		void this.messageSender?.send(0x0003, 0x0001, payload);
	}

	private sendWiggle() {
		const payload = new Uint8Array([
			Math.max(0, Math.min(255, Math.round(this.wiggleMinU8))),
			Math.max(0, Math.min(255, Math.round(this.wiggleMaxU8))),
			...this.encodeU16Le(this.timeFor180Ms),
		]);
		void this.messageSender?.send(0x0003, 0x0002, payload);
	}

	private handleServoChange(event: Event) {
		const target = event.target as HTMLInputElement;
		this.servoU8 = parseFloat(target.value);
		this.sendSetPosition(this.servoU8);
	}

	private handleWiggleMinChange(event: Event) {
		const target = event.target as HTMLInputElement;
		this.wiggleMinU8 = parseFloat(target.value);
	}

	private handleWiggleMaxChange(event: Event) {
		const target = event.target as HTMLInputElement;
		this.wiggleMaxU8 = parseFloat(target.value);
	}

	private handleTimeFor180Change(event: Event) {
		const target = event.target as HTMLInputElement;
		this.timeFor180Ms = Math.max(0, Math.round(parseFloat(target.value) || 0));
	}

	render() {
		return html`
			<div class="panel app-panel">
				<div class="panel-section">
						<div class="panel-label">Zeit fuer 180 Grad (ms)</div>
						<div class="panel-controls">
							<input
								type="number"
								class="panel-input"
								min="0"
								step="1"
								.value=${String(this.timeFor180Ms)}
								@input=${this.handleTimeFor180Change}
								?disabled=${!this.deviceConnected}
							/>
					</div>
				</div>

				<div class="panel-section">
					<div class="panel-label">Servo-Drehwinkel (Test)</div>
					<div class="panel-controls">
						<input
							type="range"
							class="panel-slider"
							min="0"
							max="255"
							.value=${String(this.servoU8)}
							@input=${this.handleServoChange}
						/>
						<div class="panel-value-row">
							<span>0°</span>
							<span class="panel-value-current">${Math.round(this.servoU8 * 180 / 255)}°</span>
							<span>180°</span>
						</div>
					</div>
				</div>

				<div class="panel-section">
					<div class="panel-label">Wiggle (Test)</div>
					<div class="panel-controls">
						<input
							type="range"
							class="panel-slider"
							min="0"
							max="255"
							.value=${String(this.wiggleMinU8)}
							@input=${this.handleWiggleMinChange}
						/>
						<div class="panel-value-row">
							<span>Wiggle Min</span>
							<span class="panel-value-current">${Math.round(this.wiggleMinU8 * 180 / 255)}°</span>
						</div>

						<input
							type="range"
							class="panel-slider"
							min="0"
							max="255"
							.value=${String(this.wiggleMaxU8)}
							@input=${this.handleWiggleMaxChange}
						/>
						<div class="panel-value-row">
							<span>Wiggle Max</span>
							<span class="panel-value-current">${Math.round(this.wiggleMaxU8 * 180 / 255)}°</span>
						</div>

						<button
							type="button"
							class="panel-choice-btn"
							@click=${this.sendWiggle}
							?disabled=${!this.deviceConnected}
						>
							WIGGLE senden
						</button>
					</div>
				</div>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"servo-test-panel": ServoTestPanel;
	}
}