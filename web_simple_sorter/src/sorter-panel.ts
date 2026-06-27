import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, ref } from "lit-html/directives/ref.js";
import type { Ref } from "lit-html/directives/ref.js";
import type { IMessageSender } from "./app.js";
import * as tmImage from "@teachablemachine/image";


enum TargetClass {
	LEFT=0,
	RIGHT=1,
	NONE=2
};

type SorterOperationMode = "sort" | "training";

type PredefinedModel = {
	name: string;
	url: string;
};

@customElement("sorter-panel")
export class SorterPanel extends LitElement {
	private static readonly DEFAULT_MODEL_URL = "https://teachablemachine.withgoogle.com/models/PDJKM0gsS/";
	private static readonly HELP_VIDEO_URL = "https://youtu.be/W0RHdbnXww4";
	private static readonly HELP_VIDEO_URL_STEP_1_AND_2 = "https://youtu.be/Ywrzp1CqoN8";
	private static readonly TRAIN_MODEL_URL = "https://teachablemachine.withgoogle.com/train/image";
	private static readonly PREDEFINED_MODELS: PredefinedModel[] = [
		{ name: "Liebler 2026-06-27", url: "https://teachablemachine.withgoogle.com/models/cxtJc3Cun/" },
		{ name: "Demo-Modell", url: "https://teachablemachine.withgoogle.com/models/UWp0-4g0k/" },
	];
	private static readonly WIGGLE_DURATION_MS = 2000;
	private static readonly WIGGLE_MIN = 80 * 255 / 180;
	private static readonly WIGGLE_MAX = 100 * 255 / 180;
	private static readonly WIGGLE_TIME_FOR_180_MS = 700;
	private static readonly DEFAULT_CENTER_POSITION = 127;
	private static readonly LEFT_DROP_POSITION = 255;
	private static readonly RIGHT_DROP_POSITION = 0;
	private static readonly DROP_TIME_FOR_180_MS = 700;
	private static readonly CENTER_TIME_FOR_180_MS = 700;
	private static readonly CENTER_SETTLE_MS = 400;
	private static readonly DROP_SETTLE_MS = 1200;
	private static readonly MINIMUM_PROBABILITY_PERCENT_FOR_DECISION = 90;

	protected createRenderRoot() {
		return this;
	}

	@property() accessor modelUrl = SorterPanel.DEFAULT_MODEL_URL;
	@property({ type: Boolean }) accessor deviceConnected = false;
	@property() accessor messageSender: IMessageSender | undefined;

	@state() private accessor statusMessage = "Modell nicht geladen";
	
	@state() private accessor leftClassPercent = 0;
	@state() private accessor rightClassPercent = 0;
	@state() private accessor lastDropSide: "left" | "right" | null = null;
	@state() private accessor operationMode: SorterOperationMode = "training";
	@state() private accessor centerCalibration = SorterPanel.DEFAULT_CENTER_POSITION;
	@state() private accessor activePredefinedModelIndex: number | null = null;
	@state() private accessor activeCustomModel = false;
	@state() private accessor isModelLoading = false;

	private model:tmImage.CustomMobileNet|null=null;
	private indexOfRightClass:number=-1;
	private indexOfLeftClass:number=-1;
	private webcam:tmImage.Webcam|null=null;
	private webcamContainerRef: Ref<HTMLDivElement> = createRef();
	private labelContainerRef: Ref<HTMLDivElement> = createRef();
	private dropAnimationTimeout: ReturnType<typeof setTimeout> | undefined;
	private decisionLoopTimeout: ReturnType<typeof setTimeout> | undefined;
	private decisionLoopRunning = false;

	firstUpdated() {
		this.ensureWebcamStarted();
		window.requestAnimationFrame(()=>{this.onAnimationFrame()});
	}

	private openHelpPage(url: string) {
		window.open(url, "_blank", "noopener,noreferrer");
	}

	private onModelInput(event: Event) {
		const target = event.target as HTMLInputElement;
		this.modelUrl = target.value;
	}

	private onCenterCalibrationInput(event: Event) {
		const target = event.target as HTMLInputElement;
		const parsed = Number.parseInt(target.value, 10);
		const sliderValue = Number.isNaN(parsed) ? SorterPanel.DEFAULT_CENTER_POSITION : parsed;
		this.centerCalibration = this.clampServoValue(255 - sliderValue);
		this.applyCenterCalibrationPreview();
	}

	private async applyCenterCalibrationPreview() {
		if (!this.messageSender || !this.deviceConnected || this.operationMode === "sort") {
			return;
		}
		await this.setServoPosition(this.getCenterPosition(), SorterPanel.CENTER_TIME_FOR_180_MS);
	}

	private async onPredefinedPlay(event: Event) {
		const target = event.currentTarget as HTMLElement | null;
		const indexAttr = target?.getAttribute("data-model-index");
		const index = Number.parseInt(indexAttr ?? "", 10);
		if (Number.isNaN(index) || index < 0 || index >= SorterPanel.PREDEFINED_MODELS.length) {
			return;
		}
		const predefinedModel = SorterPanel.PREDEFINED_MODELS[index];
		if (!predefinedModel) {
			return;
		}

		this.activePredefinedModelIndex = index;
		this.activeCustomModel = false;
		const loaded = await this.loadModelFromUrl(predefinedModel.url);
		if (loaded) {
			this.operationMode = "sort";
			await this.applyCurrentMode();
		} else {
			this.activePredefinedModelIndex = null;
		}
	}

	private async onPredefinedStop() {
		await this.stopModel();
	}

	private async onCustomPlay() {
		this.activePredefinedModelIndex = null;
		this.activeCustomModel = true;
		const loaded = await this.loadModelFromUrl(this.modelUrl);
		if (loaded) {
			this.operationMode = "sort";
			await this.applyCurrentMode();
		} else {
			this.activeCustomModel = false;
		}
	}

	private async onCustomStop() {
		await this.stopModel();
	}

	private async stopModel() {
		this.stopDecisionLoop();
		this.model = null;
		this.indexOfLeftClass = -1;
		this.indexOfRightClass = -1;
		this.leftClassPercent = 0;
		this.rightClassPercent = 0;
		this.lastDropSide = null;
		this.activePredefinedModelIndex = null;
		this.activeCustomModel = false;
		this.operationMode = "training";
		await this.applyCurrentMode();
	}

	private triggerDropAnimation(side: TargetClass) {
		this.lastDropSide = side === TargetClass.LEFT ? "left" : "right";
		if (this.dropAnimationTimeout) {
			clearTimeout(this.dropAnimationTimeout);
		}
		this.dropAnimationTimeout = setTimeout(() => {
			this.lastDropSide = null;
		}, 900);
	}

	private encodeU16Le(value: number) {
		const clamped = Math.max(0, Math.min(0xffff, Math.round(value)));
		return [clamped & 0xff, (clamped >> 8) & 0xff];
	}

	private clampServoValue(value: number) {
		return Math.max(0, Math.min(255, Math.round(value)));
	}

	private stopDecisionLoop() {
		this.decisionLoopRunning = false;
		if (this.decisionLoopTimeout) {
			clearTimeout(this.decisionLoopTimeout);
			this.decisionLoopTimeout = undefined;
		}
	}

	private getCenterPosition() {
		return this.clampServoValue(this.centerCalibration);
	}

	private getWiggleRange() {
		const defaultCenter = SorterPanel.DEFAULT_CENTER_POSITION;
		const minOffset = SorterPanel.WIGGLE_MIN - defaultCenter;
		const maxOffset = SorterPanel.WIGGLE_MAX - defaultCenter;
		const center = this.getCenterPosition();
		const wiggleMin = this.clampServoValue(center + minOffset);
		const wiggleMax = this.clampServoValue(center + maxOffset);
		return {
			wiggleMin: Math.min(wiggleMin, wiggleMax),
			wiggleMax: Math.max(wiggleMin, wiggleMax),
		};
	}

	private getDropPosition(targetClass: TargetClass) {
		const defaultCenter = SorterPanel.DEFAULT_CENTER_POSITION;
		const center = this.getCenterPosition();
		if (targetClass === TargetClass.LEFT) {
			const leftOffset = SorterPanel.LEFT_DROP_POSITION - defaultCenter;
			return this.clampServoValue(center + leftOffset);
		}
		if (targetClass === TargetClass.RIGHT) {
			const rightOffset = SorterPanel.RIGHT_DROP_POSITION - defaultCenter;
			return this.clampServoValue(center + rightOffset);
		}
		return center;
	}

	private async applyCurrentMode() {
		if (!this.messageSender) {
			return;
		}

		if (this.operationMode === "training") {
			this.stopDecisionLoop();
			await this.setLed(0, 0, 0);
			await this.setServoPosition(this.getCenterPosition(), SorterPanel.CENTER_TIME_FOR_180_MS);
			this.statusMessage = this.model ? "Modell geladen (Aus/Training)" : "Modell nicht geladen (Aus/Training)";
			if (this.model && this.webcam) {
				this.scheduleNextDecision(0);
			}
			return;
		}

		if (!this.model || !this.webcam) {
			this.operationMode = "training";
			this.statusMessage = "Bitte erst ein Model laden";
			await this.setLed(0, 0, 0);
			await this.setServoPosition(this.getCenterPosition(), SorterPanel.CENTER_TIME_FOR_180_MS);
			return;
		}

		this.stopDecisionLoop();
		this.decisionLoopRunning = true;
		this.statusMessage = "Modell geladen (Sortieren)";
		this.scheduleNextDecision(0);
	}

	private async setServoWiggle(wiggleMin: number, wiggleMax: number, timeFor180degInMs: number) {
		const payload = new Uint8Array([
			Math.max(0, Math.min(255, Math.round(wiggleMin))),
			Math.max(0, Math.min(255, Math.round(wiggleMax))),
			...this.encodeU16Le(timeFor180degInMs),
		]);
		await this.messageSender?.send(0x0003, 0x0002, payload);
	}

	private async setServoPosition(position: number, timeFor180degInMs: number) {
		const payload = new Uint8Array([
			Math.max(0, Math.min(255, Math.round(position))),
			...this.encodeU16Le(timeFor180degInMs),
		]);
		await this.messageSender?.send(0x0003, 0x0001, payload);
	}

	private async setLed(left: number, right: number, blue = 0) {
		await this.messageSender?.send(0x0002, 0x0001, new Uint8Array([left, right, blue]));
	}

	private sleep(ms: number) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private scheduleNextDecision(delayMs: number) {
		if (this.decisionLoopTimeout) {
			clearTimeout(this.decisionLoopTimeout);
		}
		this.decisionLoopTimeout = setTimeout(() => {
			void this.runDecisionCycle();
		}, delayMs);
	}

	private async runDecisionCycle() {
		if (!this.model || !this.webcam || !this.messageSender) {
			return;
		}

		if (this.operationMode === "training") {
			const prediction = await this.model.predict(this.webcam.canvas);
			this.leftClassPercent = Math.max(0, Math.min(100, (prediction[this.indexOfLeftClass]?.probability ?? 0) * 100));
			this.rightClassPercent = Math.max(0, Math.min(100, (prediction[this.indexOfRightClass]?.probability ?? 0) * 100));
			this.scheduleNextDecision(100);
			return;
		}

		if (!this.decisionLoopRunning) {
			return;
		}

		const { wiggleMin, wiggleMax } = this.getWiggleRange();

		await this.setServoWiggle(
			wiggleMin,
			wiggleMax,
			SorterPanel.WIGGLE_TIME_FOR_180_MS,
		);
		await this.sleep(SorterPanel.WIGGLE_DURATION_MS);

		if (!this.decisionLoopRunning || !this.model || !this.webcam || !this.messageSender || this.operationMode !== "sort") {
			return;
		}

		await this.setServoPosition(this.getCenterPosition(), SorterPanel.CENTER_TIME_FOR_180_MS);
		await this.sleep(SorterPanel.CENTER_SETTLE_MS);

		if (!this.decisionLoopRunning || !this.model || !this.webcam || !this.messageSender || this.operationMode !== "sort") {
			return;
		}

		const prediction = await this.model.predict(this.webcam.canvas);
		this.leftClassPercent = Math.max(0, Math.min(100, (prediction[this.indexOfLeftClass]?.probability ?? 0) * 100));
		this.rightClassPercent = Math.max(0, Math.min(100, (prediction[this.indexOfRightClass]?.probability ?? 0) * 100));

		let targetClass: TargetClass = TargetClass.NONE;
		if (this.leftClassPercent > SorterPanel.MINIMUM_PROBABILITY_PERCENT_FOR_DECISION) {
			targetClass = TargetClass.LEFT;
		} else if (this.rightClassPercent > SorterPanel.MINIMUM_PROBABILITY_PERCENT_FOR_DECISION) {
			targetClass = TargetClass.RIGHT;
		}

		if (targetClass === TargetClass.LEFT) {
			await this.setLed(255, 0, 0);
			await this.setServoPosition(this.getDropPosition(TargetClass.LEFT), SorterPanel.DROP_TIME_FOR_180_MS);
			this.triggerDropAnimation(targetClass);
			await this.sleep(SorterPanel.DROP_SETTLE_MS);
			await this.setServoPosition(this.getCenterPosition(), SorterPanel.CENTER_TIME_FOR_180_MS);
			this.scheduleNextDecision(SorterPanel.DROP_SETTLE_MS);
			return;
		}

		if (targetClass === TargetClass.RIGHT) {
			await this.setLed(0, 255, 0);
			await this.setServoPosition(this.getDropPosition(TargetClass.RIGHT), SorterPanel.DROP_TIME_FOR_180_MS);
			this.triggerDropAnimation(targetClass);
			await this.sleep(SorterPanel.DROP_SETTLE_MS);
			await this.setServoPosition(this.getCenterPosition(), SorterPanel.CENTER_TIME_FOR_180_MS);
			this.scheduleNextDecision(SorterPanel.DROP_SETTLE_MS);
			return;
		}

		await this.setLed(0, 0, 0);
		this.scheduleNextDecision(0);
	}


	private async  onAnimationFrame() {
		if (this.webcam) {
			this.webcam.update();
		}
		window.requestAnimationFrame(()=>{this.onAnimationFrame()});
    }

	private async ensureWebcamStarted() {
		try {
			const flip = true;
			this.webcam = new tmImage.Webcam(200, 200, flip);
			await this.webcam.setup();
			await this.webcam.play();
			this.webcamContainerRef.value?.replaceChildren(this.webcam.canvas);
		} catch {
			this.webcam = null;
			this.statusMessage = "Kamerazugriff fehlgeschlagen";
		}
	}

	private async loadModelFromUrl(url: string) {
		if (this.isModelLoading) {
			return false;
		}

		if (!this.deviceConnected) {
			this.statusMessage = "Bitte erst verbinden";
			return false;
		}
		
		if (!url.trim()) {
			this.statusMessage = "Bitte eine Model-URL eintragen";
			return false;
		}		

		this.isModelLoading = true;
		this.statusMessage = "Modell wird geladen...";

		try {
			const normalizedUrl = url.endsWith("/") ? url : `${url}/`;
			const modelURL = normalizedUrl + "model.json";
			const metadataURL = normalizedUrl + "metadata.json";

// load the model and metadata
				// Refer to tmImage.loadFromFiles() in the API to support files from a file picker
				// or files from your local hard drive
				// Note: the pose library adds "tmImage" object to your window (window.tmImage)
				this.model = await tmImage.load(modelURL, metadataURL);

				this.stopDecisionLoop();
				this.leftClassPercent = 0;
				this.rightClassPercent = 0;
				this.labelContainerRef.value!.innerHTML = "";
				this.indexOfLeftClass = this.model.getClassLabels().indexOf("Links");
				this.indexOfRightClass = this.model.getClassLabels().indexOf("Rechts");
				if (this.indexOfLeftClass === -1 || this.indexOfRightClass === -1) {
					this.statusMessage = "Das geladene Modell hat nicht die Klassen 'Links' und 'Rechts'";
					this.model = null;
					this.operationMode = "training";
					return false;
				}

				this.modelUrl = normalizedUrl;
				this.operationMode = "training";
				await this.applyCurrentMode();
				return true;
			} catch {
				this.statusMessage = "Modell konnte nicht geladen werden";
				this.model = null;
				return false;
			} finally {
				this.isModelLoading = false;
			}
	}

	render() {
		const playButtonsDisabled =
			!this.deviceConnected ||
			this.isModelLoading ||
			this.activePredefinedModelIndex !== null ||
			this.activeCustomModel;
		const customPlayDisabled =
			!this.deviceConnected ||
			this.isModelLoading ||
			this.activePredefinedModelIndex !== null ||
			this.activeCustomModel ||
			!this.modelUrl.trim();
		const customStopDisabled = !this.deviceConnected || this.isModelLoading || !this.activeCustomModel;
		return html`
			<div class="panel app-panel">
				<div class="panel-section sorter-workflow-step">
					<div class="sorter-workflow-header">
						<div class="panel-label">0.) Baue den SimpleSorter zusammen und schließe ihn an.</div>
						<button type="button" @click=${() => this.openHelpPage(SorterPanel.HELP_VIDEO_URL)}>Hilfe</button>
					</div>
				</div>

			<div class="panel-section sorter-workflow-step">
				<div class="sorter-workflow-header">
					<div class="panel-label">1.) Kontrolliere das Kamerabild</div>
					<button type="button" @click=${() => this.openHelpPage(SorterPanel.HELP_VIDEO_URL_STEP_1_AND_2)}>Hilfe</button>
				</div>
				<div class="panel-text">Stelle sicher, dass die Kamera mittig durch die Öffnung blickt.</div>
				<div class="sorter-webcam" ${ref(this.webcamContainerRef)}></div>
				</div>

				<div class="panel-section sorter-workflow-step">
					<div class="sorter-workflow-header">
						<div class="panel-label">2.) Stelle die Mittelpunkt-Kalibrierung ein</div>
						<button type="button" @click=${() => this.openHelpPage(SorterPanel.HELP_VIDEO_URL_STEP_1_AND_2)}>Hilfe</button>
					</div>
					<div class="panel-text">Stelle den Regler so ein, dass die Sortierwanne in der Mitte steht.</div>
					<label style="display: flex; align-items: center; gap: 0.5rem; width: 100%;">
						<span>Mittelpunkt-Kalibrierung</span>
						<input
							type="range"
							min="0"
							max="255"
							step="1"
							.value=${String(255 - this.centerCalibration)}
							@input=${this.onCenterCalibrationInput}
							?disabled=${!this.deviceConnected || this.operationMode === "sort"}
							style="flex: 1;"
						/>
					</label>
				</div>

				<div class="panel-section sorter-workflow-step">
					<div class="sorter-workflow-header">
						<div class="panel-label">3.) Wähle ein fertiges KI-Modell oder trainiere Dein eigenes Modell.</div>
						<button type="button" @click=${() => this.openHelpPage(SorterPanel.HELP_VIDEO_URL)}>Hilfe</button>
					</div>
					<div class="sorter-model-table-wrap">
						<table class="sorter-model-table" aria-label="Vordefinierte KI-Modelle">
							<thead>
								<tr>
									<th>Name</th>
									<th>URL</th>
									<th>Aktion</th>
								</tr>
							</thead>
							<tbody>
								${SorterPanel.PREDEFINED_MODELS.map((predefinedModel, index) => {
									const isActive = this.activePredefinedModelIndex === index;
									return html`
										<tr>
											<td>${predefinedModel.name}</td>
											<td class="sorter-model-url-cell">${predefinedModel.url}</td>
											<td>
												<div class="sorter-model-actions">
													<button
														type="button"
														class="sorter-action-btn"
														data-model-index=${String(index)}
														@click=${this.onPredefinedPlay}
														?disabled=${playButtonsDisabled}
														aria-label="Play"
													>
														▶
													</button>
													<button
														type="button"
														class="sorter-action-btn"
														data-model-index=${String(index)}
														@click=${this.onPredefinedStop}
														?disabled=${!isActive || this.isModelLoading || !this.deviceConnected}
														aria-label="Stop"
													>
														■
													</button>
												</div>
											</td>
										</tr>
									`;
								})}
								<tr>
									<td>
										<a href=${SorterPanel.TRAIN_MODEL_URL} target="_blank" rel="noopener noreferrer">
											Eigenes Modell trainieren
										</a>
									</td>
									<td>
										<input
											class="panel-input sorter-model-url-input"
											type="text"
											placeholder="Teachable-Machine-URL"
											.value=${this.modelUrl}
											@input=${this.onModelInput}
											?disabled=${!this.deviceConnected || this.isModelLoading}
										/>
									</td>
									<td>
										<div class="sorter-model-actions">
											<button
												type="button"
												class="sorter-action-btn"
												@click=${this.onCustomPlay}
												?disabled=${customPlayDisabled}
											>
												▶
											</button>
											<button
												type="button"
												class="sorter-action-btn"
												@click=${this.onCustomStop}
												?disabled=${customStopDisabled}
											>
												■
											</button>
										</div>
									</td>
								</tr>
							</tbody>
						</table>
					</div>
				</div>

				<div class="panel-text">${this.statusMessage}</div>

				<div class="sorter-prediction-row">
					<div class=${`sorter-drop-indicator sorter-drop-indicator-left ${this.lastDropSide === "left" ? "sorter-drop-indicator-fired" : ""}`}>
						ABWURF
					</div>
					<div
						class=${`sorter-prediction-bars ${this.lastDropSide === "left" ? "sorter-prediction-bars-left-fired" : ""} ${this.lastDropSide === "right" ? "sorter-prediction-bars-right-fired" : ""}`}
						aria-label="Klassen-Wahrscheinlichkeiten"
					>
						<div class="sorter-prediction-half sorter-prediction-half-left">
							<div
								class="sorter-prediction-fill sorter-prediction-fill-left"
								style=${`width: ${this.leftClassPercent}%;`}
							></div>
						</div>
						<div class="sorter-prediction-center-line"></div>
						<div class="sorter-prediction-half sorter-prediction-half-right">
							<div
								class="sorter-prediction-fill sorter-prediction-fill-right"
								style=${`width: ${this.rightClassPercent}%;`}
							></div>
						</div>
					</div>
					<div
						class=${`sorter-drop-indicator sorter-drop-indicator-right ${this.lastDropSide === "right" ? "sorter-drop-indicator-fired" : ""}`}
					>
						ABWURF
					</div>
				</div>
				<div class="sorter-prediction-values panel-text">
					<span>Links (Klasse 0): ${this.leftClassPercent.toFixed(0)}%</span>
					<span>Rechts (Klasse 1): ${this.rightClassPercent.toFixed(0)}%</span>
				</div>

				<div class="sorter-labels" ${ref(this.labelContainerRef)}></div>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"sorter-panel": SorterPanel;
	}
}
