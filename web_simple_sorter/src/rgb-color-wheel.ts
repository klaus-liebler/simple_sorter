import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("rgb-color-wheel")
export class RgbColorWheel extends LitElement {
	static styles = [
		css`
			:host {
				display: block;
			}
			.container {
				display: flex;
				flex-direction: column;
				align-items: center;
				gap: 20px;
			}
			.wheel {
				position: relative;
				width: 280px;
				height: 280px;
			}
			canvas {
				display: block;
				cursor: crosshair;
				border-radius: 50%;
				box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
			}
			.color-preview {
				display: flex;
				gap: 20px;
				align-items: center;
				width: 100%;
				justify-content: center;
			}
			.preview-box {
				width: 80px;
				height: 80px;
				border-radius: 8px;
				box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
				border: 2px solid #e0e0e0;
			}
			.color-values {
				display: flex;
				flex-direction: column;
				gap: 8px;
				font-size: 14px;
				font-weight: 500;
				color: #333;
			}
			.color-value {
				display: flex;
				justify-content: space-between;
				min-width: 100px;
			}
			.label {
				color: #666;
				margin-right: 10px;
			}
			.slider-container {
				width: 280px;
				display: flex;
				flex-direction: column;
				gap: 8px;
			}
			.slider-header {
				display: flex;
				justify-content: space-between;
				font-size: 14px;
				font-weight: 500;
				color: #333;
			}
			input[type="range"] {
				width: 100%;
				accent-color: #3f51b5;
				cursor: pointer;
			}
			input[type="range"]:disabled {
				opacity: 0.5;
				cursor: not-allowed;
			}
		`
	];

	@property() accessor disabled = false;

	private canvasElement: HTMLCanvasElement | null = null;
	private hue = 30;
	private saturation = 100;
	private lightness = 50;
	private currentColor = { r: 255, g: 128, b: 0 };

	firstUpdated() {
		this.drawColorWheel();
		this.updateCurrentColor(false);
	}

	private drawColorWheel() {
		const canvas = this.renderRoot.querySelector("canvas") as HTMLCanvasElement;
		if (!canvas) return;

		this.canvasElement = canvas;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const width = canvas.width;
		const height = canvas.height;
		const centerX = width / 2;
		const centerY = height / 2;
		const radius = width / 2;

		ctx.clearRect(0, 0, width, height);
		const imageData = ctx.createImageData(width, height);
		const data = imageData.data;

		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				const dx = x - centerX;
				const dy = y - centerY;
				const distance = Math.sqrt(dx * dx + dy * dy);
				const pixelIndex = (y * width + x) * 4;

				if (distance <= radius) {
					const pixelHue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
					const pixelSaturation = Math.min(100, (distance / radius) * 100);
					const rgb = this.hslToRgb(pixelHue, pixelSaturation, this.lightness);

					data[pixelIndex] = rgb.r;
					data[pixelIndex + 1] = rgb.g;
					data[pixelIndex + 2] = rgb.b;
					data[pixelIndex + 3] = 255;
				} else {
					data[pixelIndex + 3] = 0;
				}
			}
		}

		ctx.putImageData(imageData, 0, 0);

		ctx.strokeStyle = "#ddd";
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(centerX, centerY, radius - 1, 0, 2 * Math.PI);
		ctx.stroke();

		this.drawSelectionMarker(ctx, centerX, centerY, radius);
	}

	private drawSelectionMarker(
		ctx: CanvasRenderingContext2D,
		centerX: number,
		centerY: number,
		radius: number
	) {
		const angle = (this.hue * Math.PI) / 180;
		const markerRadius = (this.saturation / 100) * radius;
		const markerX = centerX + Math.cos(angle) * markerRadius;
		const markerY = centerY + Math.sin(angle) * markerRadius;

		ctx.beginPath();
		ctx.arc(markerX, markerY, 8, 0, 2 * Math.PI);
		ctx.strokeStyle = "#fff";
		ctx.lineWidth = 2;
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(markerX, markerY, 10, 0, 2 * Math.PI);
		ctx.strokeStyle = "#222";
		ctx.lineWidth = 1;
		ctx.stroke();
	}

	private hslToRgb(h: number, s: number, l: number) {
		const normalizedS = s / 100;
		const normalizedL = l / 100;
		const c = (1 - Math.abs(2 * normalizedL - 1)) * normalizedS;
		const hPrime = h / 60;
		const x = c * (1 - Math.abs((hPrime % 2) - 1));

		let r = 0;
		let g = 0;
		let b = 0;

		if (hPrime >= 0 && hPrime < 1) {
			r = c;
			g = x;
		} else if (hPrime >= 1 && hPrime < 2) {
			r = x;
			g = c;
		} else if (hPrime >= 2 && hPrime < 3) {
			g = c;
			b = x;
		} else if (hPrime >= 3 && hPrime < 4) {
			g = x;
			b = c;
		} else if (hPrime >= 4 && hPrime < 5) {
			r = x;
			b = c;
		} else {
			r = c;
			b = x;
		}

		const m = normalizedL - c / 2;
		return {
			r: Math.round((r + m) * 255),
			g: Math.round((g + m) * 255),
			b: Math.round((b + m) * 255)
		};
	}

	private updateCurrentColor(emitEvent: boolean) {
		this.currentColor = this.hslToRgb(this.hue, this.saturation, this.lightness);

		if (emitEvent) {
			this.dispatchEvent(
				new CustomEvent("color-selected", {
					detail: {
						r: this.currentColor.r,
						g: this.currentColor.g,
						b: this.currentColor.b,
						h: Math.round(this.hue),
						s: Math.round(this.saturation),
						l: Math.round(this.lightness)
					}
				})
			);
		}

		this.requestUpdate();
	}

	private handleCanvasClick(e: MouseEvent) {
		if (this.disabled || !this.canvasElement) return;

		const rect = this.canvasElement.getBoundingClientRect();
		const scaleX = this.canvasElement.width / rect.width;
		const scaleY = this.canvasElement.height / rect.height;
		const x = (e.clientX - rect.left) * scaleX;
		const y = (e.clientY - rect.top) * scaleY;

		const centerX = this.canvasElement.width / 2;
		const centerY = this.canvasElement.height / 2;
		const radius = this.canvasElement.width / 2;

		const dx = x - centerX;
		const dy = y - centerY;
		const distance = Math.sqrt(dx * dx + dy * dy);

		if (distance <= radius) {
			this.hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
			this.saturation = Math.min(100, (distance / radius) * 100);
			this.drawColorWheel();
			this.updateCurrentColor(true);
		}
	}

	private handleLightnessInput(e: Event) {
		if (this.disabled) return;

		const target = e.target as HTMLInputElement;
		const value = Number(target.value);
		if (Number.isNaN(value)) return;

		this.lightness = Math.max(0, Math.min(100, value));
		this.drawColorWheel();
		this.updateCurrentColor(true);
	}

	render() {
		return html`
			<div class="container">
				<div class="wheel">
					<canvas
						width="280"
						height="280"
						@click="${this.handleCanvasClick}"
						?disabled="${this.disabled}"
						style="${this.disabled
							? "opacity: 0.5; cursor: not-allowed;"
							: ""}"
					></canvas>
				</div>
				<div class="slider-container">
					<div class="slider-header">
						<span>Lightness</span>
						<span>${Math.round(this.lightness)}%</span>
					</div>
					<input
						type="range"
						min="0"
						max="100"
						step="1"
						.value="${String(Math.round(this.lightness))}"
						@input="${this.handleLightnessInput}"
						?disabled="${this.disabled}"
					/>
				</div>
				<div class="color-preview">
					<div
						class="preview-box"
						style="background-color: rgb(${this.currentColor.r}, ${
							this.currentColor.g
						}, ${this.currentColor.b})"
					></div>
					<div class="color-values">
						<div class="color-value">
							<span class="label">R:</span>
							<span>${this.currentColor.r}</span>
						</div>
						<div class="color-value">
							<span class="label">G:</span>
							<span>${this.currentColor.g}</span>
						</div>
						<div class="color-value">
							<span class="label">B:</span>
							<span>${this.currentColor.b}</span>
						</div>
						<div class="color-value">
							<span class="label">H:</span>
							<span>${Math.round(this.hue)}°</span>
						</div>
						<div class="color-value">
							<span class="label">S:</span>
							<span>${Math.round(this.saturation)}%</span>
						</div>
						<div class="color-value">
							<span class="label">L:</span>
							<span>${Math.round(this.lightness)}%</span>
						</div>
					</div>
				</div>
			</div>
		`;
	}
}
