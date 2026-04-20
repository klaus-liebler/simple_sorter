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
		`
	];

	@property() accessor disabled = false;

	private canvasElement: HTMLCanvasElement | null = null;
	private currentColor = { r: 255, g: 128, b: 0 };

	firstUpdated() {
		this.drawColorWheel();
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

		// Clear canvas
		ctx.clearRect(0, 0, width, height);

		// Draw color wheel
		for (let angle = 0; angle < 360; angle += 1) {
			const startAngle = (angle * Math.PI) / 180;
			const endAngle = ((angle + 1) * Math.PI) / 180;

			for (let r = 0; r < radius; r += 1) {
				// Calculate RGB from HSV
				const hue = angle;
				const saturation = r / radius;
				const value = 1;

				const rgb = this.hsvToRgb(hue, saturation, value);

				ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
				ctx.beginPath();
				ctx.arc(centerX, centerY, r, startAngle, endAngle);
				ctx.lineTo(centerX, centerY);
				ctx.fill();
			}
		}

		// Draw outer circle border
		ctx.strokeStyle = "#ddd";
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(centerX, centerY, radius - 1, 0, 2 * Math.PI);
		ctx.stroke();
	}

	private hsvToRgb(h: number, s: number, v: number) {
		const c = v * s;
		const hPrime = h / 60;
		const x = c * (1 - Math.abs((hPrime % 2) - 1));
		let r = 0,
			g = 0,
			b = 0;

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
		} else if (hPrime >= 5 && hPrime < 6) {
			r = c;
			b = x;
		}

		const m = v - c;
		return {
			r: Math.round((r + m) * 255),
			g: Math.round((g + m) * 255),
			b: Math.round((b + m) * 255)
		};
	}

	private handleCanvasClick(e: MouseEvent) {
		if (this.disabled || !this.canvasElement) return;

		const rect = this.canvasElement.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;

		const centerX = this.canvasElement.width / 2;
		const centerY = this.canvasElement.height / 2;
		const radius = this.canvasElement.width / 2;

		// Check if click is within circle
		const dx = x - centerX;
		const dy = y - centerY;
		const distance = Math.sqrt(dx * dx + dy * dy);

		if (distance <= radius) {
			// Get the image data at the clicked position
			const ctx = this.canvasElement.getContext("2d");
			if (!ctx) return;

			const imageData = ctx.getImageData(x, y, 1, 1);
			const data = imageData.data;

			this.currentColor = {
				r: data[0] ?? 0,
				g: data[1] ?? 0,
				b: data[2] ?? 0
			};

			this.dispatchEvent(
				new CustomEvent("color-selected", {
					detail: this.currentColor
				})
			);

			this.requestUpdate();
		}
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
					</div>
				</div>
			</div>
		`;
	}
}
