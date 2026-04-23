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
	@property() accessor messageSender: IMessageSender | undefined;

	@state() private accessor statusMessage = "Model nicht geladen";
	
	@state() private accessor modelLoaded = false;

	private model:tmImage.CustomMobileNet|null=null;
	private webcam:tmImage.Webcam|null=null;
	private webcamContainerRef: Ref<HTMLDivElement> = createRef();
	private labelContainerRef: Ref<HTMLDivElement> = createRef();
	private maxPredictions=0;
	private lastCommandSentAt = 0;

	private onModelInput(event: Event) {
		const target = event.target as HTMLInputElement;
		this.modelUrl = target.value;
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
		this.lastCommandSentAt = now;
	}


	private async  loop() {
        this.webcam?.update(); // update the webcam frame
        const prediction = await this.model!.predict(this.webcam!.canvas)!;
        for (let i = 0; i < this.maxPredictions; i++) {
            const classPrediction =prediction[i]!.className + ": " + prediction[i]!.probability.toFixed(2);
			const row = this.labelContainerRef.value!.children[i];
			if (row instanceof HTMLElement) {
				row.innerHTML = classPrediction;
			}
        }
		await this.sendLedForPrediction(prediction);
		
        window.requestAnimationFrame(()=>{this.loop()});
    }

	private async loadModel() {
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
		this.labelContainerRef.value!.innerHTML = "";
		this.webcamContainerRef.value!.innerHTML = "";

		
        for (let i = 0; i < this.maxPredictions; i++) { // and class labels
            this.labelContainerRef.value!.appendChild(document.createElement("div"));
        }

        // Convenience function to setup a webcam
        const flip = true; // whether to flip the webcam
        this.webcam = new tmImage.Webcam(200, 200, flip); // width, height, flip
        await this.webcam.setup(); // request access to the webcam
        await this.webcam.play();
		this.webcamContainerRef.value!.appendChild(this.webcam?.canvas);
        window.requestAnimationFrame(()=>{this.loop()});
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
					/>
					<button @click=${this.loadModel}>Model laden</button>
				</div>

				<div class="panel-text">${this.statusMessage}</div>

				<div ${ref(this.webcamContainerRef)}></div>

				<div ${ref(this.labelContainerRef)}></div>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"sorter-panel": SorterPanel;
	}
}
