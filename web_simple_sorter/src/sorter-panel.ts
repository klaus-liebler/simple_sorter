import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { IMessageSender } from "./app.js";

type SorterClassResult = {
	label: string;
	confidence: number;
};

@customElement("sorter-panel")
export class SorterPanel extends LitElement {
	protected createRenderRoot() {
		return this;
	}

	@property() accessor modelUrl = "";
	@property() accessor leftLabel = "Klasse links";
	@property() accessor rightLabel = "Klasse rechts";
	@property({ type: Boolean }) accessor deviceConnected = false;
	@property() accessor messageSender: IMessageSender | undefined;

	@state() private accessor leftConfidence = 0;
	@state() private accessor rightConfidence = 0;
	@state() private accessor servoAngle = 90;
	@state() private accessor statusMessage = "Model nicht geladen";
	@state() private accessor leftHistory: string[] = [];
	@state() private accessor rightHistory: string[] = [];
	@state() private accessor modelLoaded = false;
	@state() private accessor cameraActive = false;

	private videoElement: HTMLVideoElement | null = null;
	private canvasElement: HTMLCanvasElement | null = null;
	private mediaStream: MediaStream | null = null;
	private animationFrameId: number | null = null;

	private onModelInput(event: Event) {
		const target = event.target as HTMLInputElement;
		this.modelUrl = target.value;
	}

	private loadModel() {
		if (!this.modelUrl.trim()) {
			this.statusMessage = "Bitte eine Model-URL eintragen";
			return;
		}

		this.modelLoaded = true;
		this.statusMessage = "Model geladen";
		this.dispatchEvent(
			new CustomEvent("load-model", {
				detail: { url: this.modelUrl },
				bubbles: true,
				composed: true
			})
		);
	}

	private handleServoChange(event: Event) {
		const target = event.target as HTMLInputElement;
		this.servoAngle = parseFloat(target.value);
		const clampedAngle = Math.max(0, Math.min(180, Math.round(this.servoAngle)));
		const payload = new Uint8Array([clampedAngle]);
		void this.messageSender?.send(0x0002, 0x0002, payload);
	}

	private async startCamera() {
		try {
			this.mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
			this.cameraActive = true;
			
			// Set video element to play after next update
			await this.updateComplete;
			const videoEl = this.renderRoot.querySelector(".camera-video") as HTMLVideoElement;
			if (videoEl) {
				videoEl.srcObject = this.mediaStream;
				await videoEl.play();
				this.drawCameraFrame();
			}
		} catch (error) {
			this.statusMessage = `Kamerazugriff fehlgeschlagen: ${error}`;
		}
	}

	private stopCamera() {
		if (this.animationFrameId) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = null;
		}
		if (this.mediaStream) {
			this.mediaStream.getTracks().forEach(track => track.stop());
			this.mediaStream = null;
		}
		this.cameraActive = false;
	}

	private drawCameraFrame() {
		const videoEl = this.renderRoot.querySelector(".camera-video") as HTMLVideoElement;
		const canvasEl = this.renderRoot.querySelector(".camera-canvas") as HTMLCanvasElement;
		
		if (!videoEl || !canvasEl || videoEl.videoWidth === 0) {
			this.animationFrameId = requestAnimationFrame(() => this.drawCameraFrame());
			return;
		}

		const ctx = canvasEl.getContext("2d");
		if (!ctx) return;

		// Set canvas size to video dimensions
		canvasEl.width = videoEl.videoWidth;
		canvasEl.height = videoEl.videoHeight;

		// Draw video frame
		ctx.drawImage(videoEl, 0, 0);

		if (this.cameraActive) {
			this.animationFrameId = requestAnimationFrame(() => this.drawCameraFrame());
		}
	}

	updateClassification(results: SorterClassResult[]) {
		const left = results.find(result => result.label === this.leftLabel);
		const right = results.find(result => result.label === this.rightLabel);

		this.leftConfidence = Math.max(0, Math.min(1, left?.confidence ?? 0));
		this.rightConfidence = Math.max(0, Math.min(1, right?.confidence ?? 0));
	}

	addHistoryImage(side: "left" | "right", imageUrl: string) {
		const list = side === "left" ? this.leftHistory : this.rightHistory;
		const next = [imageUrl, ...list].slice(0, 9);
		if (side === "left") {
			this.leftHistory = next;
		} else {
			this.rightHistory = next;
		}
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		this.stopCamera();
	}

	render() {
		return html`
			<div class="panel">
				<div class="top-row">
					<input
						type="text"
						placeholder="Teachable-Machine URL"
						.value=${this.modelUrl}
						@input=${this.onModelInput}
					/>
					<button @click=${this.loadModel}>Model laden</button>
				</div>

				<div class="status">${this.statusMessage}</div>

				<div class="camera-section">
					<video class="camera-video"></video>
					<canvas class="camera-canvas" width="320" height="240"></canvas>
					<div class="camera-controls">
						<button @click=${() => void this.startCamera()} ?disabled=${this.cameraActive}>
							Kamera starten
						</button>
						<button @click=${() => this.stopCamera()} ?disabled=${!this.cameraActive}>
							Kamera stoppen
						</button>
					</div>
				</div>

				<div class="class-grid">
					<div class="class-card">
						<div class="class-label">${this.leftLabel}</div>
						<div class="confidence-track">
							<div class="confidence-fill" style=${`width: ${this.leftConfidence * 100}%`}></div>
						</div>
						<div class="confidence-text">${Math.round(this.leftConfidence * 100)}%</div>
					</div>

					<div class="class-card">
						<div class="class-label">${this.rightLabel}</div>
						<div class="confidence-track">
							<div class="confidence-fill" style=${`width: ${this.rightConfidence * 100}%`}></div>
						</div>
						<div class="confidence-text">${Math.round(this.rightConfidence * 100)}%</div>
					</div>
				</div>

				<div class="servo-section">
					<div class="servo-label">Servo-Drehwinkel</div>
					<div class="servo-controls">
						<input
							type="range"
							class="servo-slider"
							min="0"
							max="180"
							.value=${String(this.servoAngle)}
							@input=${this.handleServoChange}
						/>
						<div class="servo-value">
							<span>0°</span>
							<span style="font-weight: 600;">${Math.round(this.servoAngle)}°</span>
							<span>180°</span>
						</div>
					</div>
				</div>

				<div class="history">
					<div class="history-column">
						<div class="history-title">Verlauf links</div>
						<div class="history-grid">
							${this.leftHistory.length === 0
								? html`<div class="history-item">leer</div>`
								: this.leftHistory.map(
									image => html`<div class="history-item"><img src=${image} alt="Left history" /></div>`
								)}
						</div>
					</div>
					<div class="history-column">
						<div class="history-title">Verlauf rechts</div>
						<div class="history-grid">
							${this.rightHistory.length === 0
								? html`<div class="history-item">leer</div>`
								: this.rightHistory.map(
									image => html`<div class="history-item"><img src=${image} alt="Right history" /></div>`
								)}
						</div>
					</div>
				</div>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"sorter-panel": SorterPanel;
	}
}
