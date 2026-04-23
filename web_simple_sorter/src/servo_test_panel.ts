import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { IMessageSender } from "./app.js";
import { SorterMode } from "./SorterMode.ts";

@customElement("servo-test-panel")
export class ServoTestPanel extends LitElement {
	protected createRenderRoot() {
		return this;
	}

	@property({ type: Boolean }) accessor deviceConnected = false;
	@property() accessor messageSender: IMessageSender | undefined;

	@state() private accessor servoU8 = 90;
	@state() private accessor selectedMode = SorterMode.NO_DYNAMICS;

	private readonly modeOptions: Array<{ mode: SorterMode; label: string }> = [
		{ mode: SorterMode.NO_DYNAMICS, label: "NO_DYNAMICS" },
		{ mode: SorterMode.RIGHT, label: "RIGHT" },
		{ mode: SorterMode.WIGGLE, label: "WIGGLE" },
		{ mode: SorterMode.LEFT, label: "LEFT" }
	];

	private handleServoChange(event: Event) {
		const target = event.target as HTMLInputElement;
		this.servoU8 = parseFloat(target.value);

		const payload = new Uint8Array([this.servoU8]);
		void this.messageSender?.send(0x0003, 0x0001, payload);
	}

	private handleModeChange(mode: SorterMode) {
		if (this.selectedMode === mode) {
			return;
		}

		this.selectedMode = mode;
		const payload = new Uint8Array([mode]);
		void this.messageSender?.send(0x0003, 0x0002, payload);
	}

	render() {
		return html`
			<div class="panel app-panel">
				<div class="panel-section">
					<div class="panel-label">Betriebsmodus (Test)</div>
					<div class="panel-button-grid">
						${this.modeOptions.map(
							({ mode, label }) => html`
								<button
									type="button"
									class="panel-choice-btn ${this.selectedMode === mode ? "active" : ""}"
									@click=${() => this.handleModeChange(mode)}
									?disabled=${!this.deviceConnected}
								>
									${label}
								</button>
							`
						)}
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
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"servo-test-panel": ServoTestPanel;
	}
}
