import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "./connect-panel.js";
import "./rgb-color-wheel.js";

@customElement("my-app")
export class Application extends LitElement {
	static styles = [
		css`
			:host {
				display: block;
				font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
					sans-serif;
			}
			.container {
				max-width: 600px;
				margin: 0 auto;
				padding: 20px;
			}
			.header-section {
				border-bottom: 2px solid #e0e0e0;
				padding-bottom: 20px;
				margin-bottom: 30px;
			}
			.content-section {
				display: flex;
				justify-content: center;
				align-items: center;
				min-height: 400px;
			}
		`
	];

	@state() protected accessor device: USBDevice | null = null;
	@state() protected accessor deviceConnected = false;
	@state() protected accessor statusMessage = "Not connected";

	private requestDevice = async () => {
		try {
			const device = await navigator.usb.requestDevice({ filters: [] });
			this.device = device;
			await this.connectDevice();
		} catch (error) {
			console.error("Error requesting device:", error);
			this.statusMessage = "Device request cancelled";
		}
	};

	private connectedInterfaceNumber: number | null = null;
	private outEndpointNumber: number | null = null;
	private static readonly RGB_NAMESPACE = 0x0002;
	private static readonly RGB_MESSAGE_ID = 0x0001;
	private static readonly RGB_FRAME_SIZE = 64;

	private readonly usbClassNames = new Map<number, string>([
		[0x00, "Defined at interface level"],
		[0x01, "Audio"],
		[0x02, "Communications and CDC Control"],
		[0x03, "Human Interface Device (HID)"],
		[0x05, "Physical"],
		[0x06, "Image"],
		[0x07, "Printer"],
		[0x08, "Mass Storage"],
		[0x09, "Hub"],
		[0x0a, "CDC-Data"],
		[0x0b, "Smart Card"],
		[0x0d, "Content Security"],
		[0x0e, "Video"],
		[0x0f, "Personal Healthcare"],
		[0x10, "Audio/Video Devices"],
		[0x11, "Billboard Device Class"],
		[0x12, "USB Type-C Bridge Class"],
		[0x13, "USB Bulk Display Protocol Device Class"],
		[0x14, "MCTP over USB Protocol Endpoint Device Class"],
		[0x3c, "I3C Device Class"],
		[0xdc, "Diagnostic Device"],
		[0xe0, "Wireless Controller"],
		[0xef, "Miscellaneous"],
		[0xfe, "Application Specific"],
		[0xff, "Vendor Specific"]
	]);

	private formatHex8(value: number): string {
		return `0x${value.toString(16).padStart(2, "0")}`;
	}

	private classCodeName(classCode: number): string {
		return this.usbClassNames.get(classCode) ?? "Unknown / Reserved";
	}

	private async getSupportedLangId(): Promise<number> {
		if (!this.device) return 0x0409;

		try {
			const result = await this.device.controlTransferIn(
				{
					requestType: "standard",
					recipient: "device",
					request: 0x06,
					value: (0x03 << 8) | 0,
					index: 0
				},
				255
			);

			if (!result.data) return 0x0409;
			const bytes = new Uint8Array(result.data.buffer);
			if (bytes.length < 4) return 0x0409;

			// First language ID starts at byte 2 (little-endian).
			const langId = ((bytes[3] ?? 0) << 8) | (bytes[2] ?? 0);
			return langId || 0x0409;
		} catch {
			return 0x0409;
		}
	}

	private async getUsbStringDescriptor(index: number, langId: number): Promise<string | null> {
		if (!this.device || index <= 0) return null;

		try {
			const result = await this.device.controlTransferIn(
				{
					requestType: "standard",
					recipient: "device",
					request: 0x06,
					value: (0x03 << 8) | (index & 0xff),
					index: langId
				},
				255
			);

			if (!result.data) return null;
			const bytes = new Uint8Array(result.data.buffer);
			if (bytes.length < 2) return null;

			const declaredLen = bytes[0] ?? 0;
			const usableLen = Math.min(declaredLen, bytes.length);
			if (usableLen <= 2) return "";

			const payload = bytes.slice(2, usableLen);
			return new TextDecoder("utf-16le").decode(payload).replace(/\u0000/g, "");
		} catch {
			return null;
		}
	}

	private async readInterfaceStringIndices(configIndex: number): Promise<Map<string, number>> {
		const map = new Map<string, number>();
		if (!this.device) return map;

		try {
			const header = await this.device.controlTransferIn(
				{
					requestType: "standard",
					recipient: "device",
					request: 0x06,
					value: (0x02 << 8) | (configIndex & 0xff),
					index: 0
				},
				9
			);

			if (!header.data) return map;
			const h = new Uint8Array(header.data.buffer);
			if (h.length < 4) return map;

			const totalLength = ((h[3] ?? 0) << 8) | (h[2] ?? 0);
			if (totalLength <= 0) return map;

			const full = await this.device.controlTransferIn(
				{
					requestType: "standard",
					recipient: "device",
					request: 0x06,
					value: (0x02 << 8) | (configIndex & 0xff),
					index: 0
				},
				totalLength
			);

			if (!full.data) return map;
			const bytes = new Uint8Array(full.data.buffer);

			let offset = 0;
			while (offset + 1 < bytes.length) {
				const bLength = bytes[offset] ?? 0;
				const bDescriptorType = bytes[offset + 1] ?? 0;
				if (bLength < 2) break;

				// Interface descriptor (type 0x04):
				// [2]=bInterfaceNumber, [3]=bAlternateSetting, [8]=iInterface
				if (bDescriptorType === 0x04 && bLength >= 9 && offset + 8 < bytes.length) {
					const ifaceNumber = bytes[offset + 2] ?? 0;
					const altSetting = bytes[offset + 3] ?? 0;
					const iInterface = bytes[offset + 8] ?? 0;
					map.set(`${ifaceNumber}:${altSetting}`, iInterface);
				}

				offset += bLength;
			}
		} catch {
			// Best-effort only: ignore descriptor parsing failures.
		}

		return map;
	}

	private connectDevice = async () => {
		if (!this.device) return;
		try {
			await this.device.open();

			// Log device info for debugging
			console.log("Device opened successfully");
			console.log("Manufacturer:", this.device.manufacturerName || "<none>");
			console.log("Product:", this.device.productName || "<none>");
			console.log("Serial:", this.device.serialNumber || "<none>");
			console.log("Configurations:", this.device.configurations.length);
			console.log(
				"Device class:",
				`${this.formatHex8(this.device.deviceClass)} (${this.classCodeName(this.device.deviceClass)})`
			);
			console.log("Device subclass:", this.device.deviceSubclass);

			// Select the first configuration
			const config = this.device.configurations[0];
			if (!config) {
				throw new Error("No configurations available");
			}

			console.log("Selecting configuration:", config.configurationValue);
			console.log("Configuration name:", config.configurationName || "<none>");
			console.log("Interfaces in config:", config.interfaces.length);

			const langId = await this.getSupportedLangId();
			const interfaceStringIndexMap = await this.readInterfaceStringIndices(0);
			console.log("USB string language ID:", `0x${langId.toString(16)}`);

			await this.device.selectConfiguration(config.configurationValue);

			// Try to find a Vendor Specific (0xff) interface with OUT endpoints
			let foundInterface: USBInterface | null = null;
			let foundOutEndpoint: USBEndpoint | null = null;
			let foundMatchScore = -1;

			for (const iface of config.interfaces) {
				console.log(`\nChecking interface ${iface.interfaceNumber}:`);
				console.log(`  - Claimed: ${iface.claimed}`);
				console.log(`  - Alternate interfaces: ${iface.alternates.length}`);

				for (const alt of iface.alternates) {
					const outEndpoints = alt.endpoints.filter(ep => ep.direction === "out");
					const inEndpoints = alt.endpoints.filter(ep => ep.direction === "in");
					const descriptorStringIndex =
						interfaceStringIndexMap.get(`${iface.interfaceNumber}:${alt.alternateSetting}`) ?? 0;
					const explicitDescriptorName = await this.getUsbStringDescriptor(
						descriptorStringIndex,
						langId
					);

					console.log(`    Alternate ${alt.alternateSetting}:`);
					console.log(
						`      - Class: ${this.formatHex8(alt.interfaceClass)} (${this.classCodeName(alt.interfaceClass)})`
					);
					console.log(`      - Subclass: ${this.formatHex8(alt.interfaceSubclass)}`);
					console.log(`      - Protocol: ${this.formatHex8(alt.interfaceProtocol)}`);
					console.log(`      - Interface name: ${alt.interfaceName || "<none>"}`);
					console.log(
						`      - Interface name (explicit string descriptor): ${explicitDescriptorName || "<none>"}`
					);
					console.log(`      - iInterface index: ${descriptorStringIndex}`);
					console.log(`      - OUT endpoints: ${outEndpoints.length}`, outEndpoints.map(ep => ({
						number: ep.endpointNumber,
						type: ep.type,
						packetSize: ep.packetSize
					})));
					console.log(`      - IN endpoints: ${inEndpoints.length}`, inEndpoints.map(ep => ({
						number: ep.endpointNumber,
						type: ep.type,
						packetSize: ep.packetSize
					})));

					// Strict selection:
					// 1) ONLY class 0xff (Vendor Specific)
					// 2) Prefer interface number 2 among 0xff candidates
					if (outEndpoints.length > 0 && alt.interfaceClass === 0xff) {
						let score = 100;
						if (iface.interfaceNumber === 2) score += 10;

						if (score > foundMatchScore) {
							foundMatchScore = score;
							foundInterface = iface;
							foundOutEndpoint = outEndpoints[0] ?? null;
							console.log(
								`      ✓ Candidate selected (score=${score}) on interface ${iface.interfaceNumber}, class ${this.formatHex8(alt.interfaceClass)}`
							);
						}
					}
				}
			}

			// Strict mode: fail if no Vendor Specific (0xff) OUT endpoint exists.
			if (!foundInterface) {
				throw new Error(
					"No Vendor Specific (class 0xff) interface with OUT endpoint found"
				);
			}

			if (!foundOutEndpoint && foundInterface.alternates.length > 0) {
				const firstAlt = foundInterface.alternates[0];
				if (firstAlt && firstAlt.endpoints.length > 0) {
					foundOutEndpoint = firstAlt.endpoints[0] ?? null;
				}
			}

			this.connectedInterfaceNumber = foundInterface.interfaceNumber;
			this.outEndpointNumber = foundOutEndpoint?.endpointNumber ?? 1;
			console.log(
				`\nFinal selected interface: ${this.connectedInterfaceNumber}, endpoint: ${this.outEndpointNumber}, matchScore=${foundMatchScore}`
			);

			// Try to claim the interface
			if (!foundInterface.claimed) {
				try {
					console.log(`\nAttempting to claim interface ${foundInterface.interfaceNumber}`);
					await this.device.claimInterface(foundInterface.interfaceNumber);
					console.log("Interface claimed successfully");
				} catch (claimError) {
					console.warn("Could not claim interface - will try to send anyway:", claimError);
					// Do NOT throw - we'll try to send anyway
				}
			}

			this.deviceConnected = true;
			this.statusMessage = `Connected: ${this.device.productName || "Unknown Device"} (Interface ${this.connectedInterfaceNumber}, Endpoint ${this.outEndpointNumber})`;
			console.log(`\n✓ Device ready. Will use interface ${this.connectedInterfaceNumber} with endpoint ${this.outEndpointNumber}`);
		} catch (error) {
			console.error("Error opening device:", error);
			this.statusMessage = `Failed to connect: ${error instanceof Error ? error.message : "Unknown error"}`;
		}
	};

	private disconnectDevice = async () => {
		if (!this.device) return;
		try {
			// Try to release all claimed interfaces (they might not be claimed)
			for (const config of this.device.configurations) {
				for (const iface of config.interfaces) {
					if (iface.claimed) {
						try {
							console.log(`Releasing interface ${iface.interfaceNumber}`);
							await this.device.releaseInterface(iface.interfaceNumber);
						} catch (e) {
							console.warn(`Could not release interface ${iface.interfaceNumber}:`, e);
						}
					}
				}
			}

			await this.device.close();
			this.device = null;
			this.deviceConnected = false;
			this.connectedInterfaceNumber = null;
			this.outEndpointNumber = null;
			this.statusMessage = "Disconnected";
			console.log("Device closed successfully");
		} catch (error) {
			console.error("Error closing device:", error);
			this.statusMessage = "Error disconnecting device";
		}
	};

	private sendColorMessage = (r: number, g: number, b: number) => {
		if (!this.device || !this.deviceConnected) {
			alert("Device not connected");
			return;
		}

		if (this.outEndpointNumber === null) {
			alert("No output endpoint found");
			return;
		}

		// Protocol (little-endian):
		// byte 0-1: namespace (0x0002)
		// byte 2-3: message id
		// byte 4-6: RGB
		// byte 7-63: unused/padding
		const buffer = new ArrayBuffer(Application.RGB_FRAME_SIZE);
		const view = new DataView(buffer);

		view.setUint16(0, Application.RGB_NAMESPACE, true);
		view.setUint16(2, Application.RGB_MESSAGE_ID, true);

		// Write 3 x u8 RGB values
		view.setUint8(4, r);
		view.setUint8(5, g);
		view.setUint8(6, b);

		// Log what we're sending
		const bytes = Array.from(new Uint8Array(buffer).slice(0, 8))
			.map(b => "0x" + b.toString(16).padStart(2, "0"))
			.join(" ");
		console.log(
			`Sending to endpoint ${this.outEndpointNumber}: [${bytes}] (ns=0x${Application.RGB_NAMESPACE.toString(16)}, msg=0x${Application.RGB_MESSAGE_ID.toString(16)}, RGB: ${r}, ${g}, ${b}, len=${Application.RGB_FRAME_SIZE})`
		);

		// Send to device
		this.device
			.transferOut(this.outEndpointNumber, buffer)
			.then((result) => {
				console.log(`✓ Transfer successful, bytes written: ${result.bytesWritten}`);
				this.statusMessage = `✓ Sent RGB(${r}, ${g}, ${b})`;
			})
			.catch((error: any) => {
				console.error("Error sending data:", error);
				this.statusMessage = `Error: ${error.message || error}`;
			});
	};

	render() {
		return html`
			<div class="container">
				<div class="header-section">
					<connect-panel
						?isConnected="${this.deviceConnected}"
						.statusMessage="${this.statusMessage}"
						@request-device="${this.requestDevice}"
						@disconnect-device="${this.disconnectDevice}"
					></connect-panel>
				</div>
				<div class="content-section">
					<rgb-color-wheel
						?disabled="${!this.deviceConnected}"
						@color-selected="${(e: CustomEvent<{ r: number; g: number; b: number }>) =>
							this.sendColorMessage(e.detail.r, e.detail.g, e.detail.b)}"
					></rgb-color-wheel>
				</div>
			</div>
		`;
	}
}