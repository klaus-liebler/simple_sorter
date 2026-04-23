import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, ref } from "lit-html/directives/ref.js";
import type { Ref } from "lit-html/directives/ref.js";
import type { IMessageSender } from "./app.js";
import  { SorterMode } from "./SorterMode.ts";
import * as tmImage from "@teachablemachine/image";

type SorterClassResult = {
	label: string;
	confidence: number;
};

@customElement("sorter-panel")
export class SorterPanel extends LitElement {
	private static readonly DEFAULT_MODEL_URL = "https://teachablemachine.withgoogle.com/models/Wq-djWmcV/";

	protected createRenderRoot() {
		return this;
	}

	@property() accessor modelUrl = SorterPanel.DEFAULT_MODEL_URL;
	@property({ type: Boolean }) accessor deviceConnected = false;
	@property() accessor messageSender: IMessageSender | undefined;

	@state() private accessor statusMessage = "Model nicht geladen";
	
	@state() private accessor modelLoaded = false;
	@state() private accessor leftClassPercent = 0;
	@state() private accessor rightClassPercent = 0;
	@state() private accessor lastDropSide: "left" | "right" | null = null;

	private model:tmImage.CustomMobileNet|null=null;
	private webcam:tmImage.Webcam|null=null;
	private webcamContainerRef: Ref<HTMLDivElement> = createRef();
	private labelContainerRef: Ref<HTMLDivElement> = createRef();
	private maxPredictions=0;
	private lastCommandSentAt = 0;
	private predictionLoopRunning = false;
	private dropAnimationTimeout: ReturnType<typeof setTimeout> | undefined;

	firstUpdated() {
		void this.ensureWebcamStarted();
	}

	private onModelInput(event: Event) {
		const target = event.target as HTMLInputElement;
		this.modelUrl = target.value;
	}

	private triggerDropAnimation(side: "left" | "right") {
		this.lastDropSide = side;
		if (this.dropAnimationTimeout) {
			clearTimeout(this.dropAnimationTimeout);
		}
		this.dropAnimationTimeout = setTimeout(() => {
			this.lastDropSide = null;
		}, 900);
	}

	private async sendLedForPrediction(prediction: Array<{ probability: number }>) {
		const class0Probability = prediction[0]?.probability ?? 0;
		const class1Probability = prediction[1]?.probability ?? 0;

		let targetClass: number=-1;
		if (class0Probability > 0.9) {
			targetClass = 0;
		} else if (class1Probability > 0.9) {
			targetClass = 1;
		}

		const now = Date.now();
		if (
			targetClass === -1 ||
			now - this.lastCommandSentAt < 2000
		) {
			return;
		}

		const payloadLED =
			targetClass === 0
				? new Uint8Array([255, 0, 0])
				: new Uint8Array([0, 255, 0]);

		await this.messageSender?.send(0x0002, 0x0001, payloadLED);
		let sm:SorterMode=SorterMode.NO_DYNAMICS;
		if(targetClass === 0) {
			sm=SorterMode.RIGHT;
		}else if(targetClass === 1) {
			sm=SorterMode.LEFT;
		}

		const payloadServo = new Uint8Array([sm]);
		await this.messageSender?.send(0x0003, 0x0002, payloadServo);
		this.triggerDropAnimation(targetClass === 0 ? "left" : "right");
		this.lastCommandSentAt = now;
	}


	private async  onAnimationFrame() {
		if (!this.model || !this.webcam) {
			this.predictionLoopRunning = false;
			return;
		}

        this.webcam?.update(); // update the webcam frame
        const prediction = await this.model!.predict(this.webcam!.canvas)!;
        for (let i = 0; i < this.maxPredictions; i++) {
            const classPrediction =prediction[i]!.className + ": " + prediction[i]!.probability.toFixed(2);
			const row = this.labelContainerRef.value!.children[i];
			if (row instanceof HTMLElement) {
				row.innerHTML = classPrediction;
			}
        }
		this.leftClassPercent = Math.max(0, Math.min(100, (prediction[0]?.probability ?? 0) * 100));
		this.rightClassPercent = Math.max(0, Math.min(100, (prediction[1]?.probability ?? 0) * 100));
		await this.sendLedForPrediction(prediction);
		
        window.requestAnimationFrame(()=>{this.onAnimationFrame()});
    }

	private async ensureWebcamStarted() {
		if (this.webcam) {
			return;
		}

		try {
			const flip = true;
			this.webcam = new tmImage.Webcam(200, 200, flip);
			await this.webcam.setup();
			await this.webcam.play();
			this.webcamContainerRef.value?.replaceChildren(this.webcam.canvas);
		} catch {
			this.statusMessage = "Kamerazugriff fehlgeschlagen";
		}
	}

	private async loadModel() {
		if (!this.deviceConnected) {
			this.statusMessage = "Bitte erst verbinden";
			return;
		}

		await this.ensureWebcamStarted();
		if (!this.webcam) {
			return;
		}

		if (!this.modelUrl.trim()) {
			this.statusMessage = "Bitte eine Model-URL eintragen";
			return;
		}

		
		const modelURL = this.modelUrl + "model.json";
        const metadataURL = this.modelUrl + "metadata.json";

        // load the model and metadata
        // Refer to tmImage.loadFromFiles() in the API to support files from a file picker
        // or files from your local hard drive
        // Note: the pose library adds "tmImage" object to your window (window.tmImage)
        this.model = await tmImage.load(modelURL, metadataURL);
		this.modelLoaded = true;
		this.statusMessage = "Model geladen";
        this.maxPredictions = this.model.getTotalClasses();
		this.lastCommandSentAt = 0;
		this.leftClassPercent = 0;
		this.rightClassPercent = 0;
		this.labelContainerRef.value!.innerHTML = "";


		if (!this.predictionLoopRunning) {
			this.predictionLoopRunning = true;
			window.requestAnimationFrame(()=>{this.onAnimationFrame()});
		}
	}

	render() {
		return html`
			<div class="panel app-panel">
				<div class="panel-row">
					<input
						class="panel-input"
						type="text"
						placeholder="Teachable-Machine URL"
						.value=${this.modelUrl}
						@input=${this.onModelInput}
						?disabled=${!this.deviceConnected}
						style=${!this.deviceConnected ? "opacity: 0.5; cursor: not-allowed;" : ""}
					/>
					<button ?disabled=${!this.deviceConnected} @click=${this.loadModel}>Model laden</button>
				</div>

				<div class="panel-text">${this.statusMessage}</div>

				<div class="sorter-webcam" ${ref(this.webcamContainerRef)}></div>

				<div class="sorter-prediction-row">
					<div
						class=${`sorter-drop-indicator sorter-drop-indicator-left ${this.lastDropSide === "left" ? "sorter-drop-indicator-fired" : ""}`}
					>
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
