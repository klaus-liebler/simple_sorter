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

@customElement("sorter-panel")
export class SorterPanel extends LitElement {
	private static readonly DEFAULT_MODEL_URL = "https://teachablemachine.withgoogle.com/models/UWp0-4g0k/";
	private static readonly WIGGLE_DURATION_MS = 2000;
	private static readonly WIGGLE_MIN = 80 * 255 / 180;
	private static readonly WIGGLE_MAX = 100 * 255 / 180;
	private static readonly WIGGLE_TIME_FOR_180_MS = 700;
	private static readonly CENTER_POSITION = 127;
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

	@state() private accessor statusMessage = "Model nicht geladen";
	
	@state() private accessor leftClassPercent = 0;
	@state() private accessor rightClassPercent = 0;
	@state() private accessor lastDropSide: "left" | "right" | null = null;

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

	private onModelInput(event: Event) {
		const target = event.target as HTMLInputElement;
		this.modelUrl = target.value;
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
		if (!this.decisionLoopRunning || !this.model || !this.webcam || !this.messageSender) {
			return;
		}

		await this.setServoWiggle(
			SorterPanel.WIGGLE_MIN,
			SorterPanel.WIGGLE_MAX,
			SorterPanel.WIGGLE_TIME_FOR_180_MS,
		);
		await this.sleep(SorterPanel.WIGGLE_DURATION_MS);

		if (!this.decisionLoopRunning || !this.model || !this.webcam || !this.messageSender) {
			return;
		}

		await this.setServoPosition(SorterPanel.CENTER_POSITION, SorterPanel.CENTER_TIME_FOR_180_MS);
		await this.sleep(SorterPanel.CENTER_SETTLE_MS);

		if (!this.decisionLoopRunning || !this.model || !this.webcam || !this.messageSender) {
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
			await this.setServoPosition(SorterPanel.LEFT_DROP_POSITION, SorterPanel.DROP_TIME_FOR_180_MS);
			this.triggerDropAnimation(targetClass);
			await this.sleep(SorterPanel.DROP_SETTLE_MS);
			await this.setServoPosition(SorterPanel.CENTER_POSITION, SorterPanel.CENTER_TIME_FOR_180_MS);
			this.scheduleNextDecision(SorterPanel.DROP_SETTLE_MS);
			return;
		}

		if (targetClass === TargetClass.RIGHT) {
			await this.setLed(0, 255, 0);
			await this.setServoPosition(SorterPanel.RIGHT_DROP_POSITION, SorterPanel.DROP_TIME_FOR_180_MS);
			this.triggerDropAnimation(targetClass);
			await this.sleep(SorterPanel.DROP_SETTLE_MS);
			await this.setServoPosition(SorterPanel.CENTER_POSITION, SorterPanel.CENTER_TIME_FOR_180_MS);
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

	private async loadModel() {
		if (!this.deviceConnected) {
			this.statusMessage = "Bitte erst verbinden";
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

		this.decisionLoopRunning = false;
		if (this.decisionLoopTimeout) {
			clearTimeout(this.decisionLoopTimeout);
			this.decisionLoopTimeout = undefined;
		}
		this.leftClassPercent = 0;
		this.rightClassPercent = 0;
		this.labelContainerRef.value!.innerHTML = "";
		this.indexOfLeftClass=this.model.getClassLabels().indexOf("Links");
		this.indexOfRightClass=this.model.getClassLabels().indexOf("Rechts");
		if(this.indexOfLeftClass===-1 || this.indexOfRightClass===-1) {
			this.statusMessage = "Das geladene Modell hat nicht die Klassen 'Links' und 'Rechts'";
			this.model=null;
			return;
		}
		this.statusMessage = "Model geladen";
		this.decisionLoopRunning = true;
		this.scheduleNextDecision(0);
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
