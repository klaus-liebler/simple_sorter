export class UsbService {
	private device: USBDevice | null = null;
	private deviceConnected = false;
	private statusMessage = "Not connected";
	private connectedInterfaceNumber: number | null = null;
	private outEndpointNumber: number | null = null;

	private static readonly FRAME_SIZE = 64;

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

	constructor(
		private readonly onStateChange: (state: {
			deviceConnected: boolean;
			statusMessage: string;
		}) => void
	) {
		this.emitState();
	}

	private emitState() {
		this.onStateChange({
			deviceConnected: this.deviceConnected,
			statusMessage: this.statusMessage
		});
	}

	private setStatus(message: string) {
		this.statusMessage = message;
		this.emitState();
	}

	private setConnected(connected: boolean) {
		this.deviceConnected = connected;
		this.emitState();
	}

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

	async requestDevice() {
		try {
			const device = await navigator.usb.requestDevice({ filters: [] });
			this.device = device;
			await this.connectDevice();
		} catch (error) {
			console.error("Error requesting device:", error);
			this.setStatus("Device request cancelled");
		}
	}

	private async connectDevice() {
		if (!this.device) return;
		try {
			await this.device.open();

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

			if (!foundInterface.claimed) {
				try {
					console.log(`\nAttempting to claim interface ${foundInterface.interfaceNumber}`);
					await this.device.claimInterface(foundInterface.interfaceNumber);
					console.log("Interface claimed successfully");
				} catch (claimError) {
					console.warn("Could not claim interface - will try to send anyway:", claimError);
				}
			}

			this.setConnected(true);
			this.setStatus(
				`Connected: ${this.device.productName || "Unknown Device"} (Interface ${this.connectedInterfaceNumber}, Endpoint ${this.outEndpointNumber})`
			);
			console.log(
				`\n✓ Device ready. Will use interface ${this.connectedInterfaceNumber} with endpoint ${this.outEndpointNumber}`
			);
		} catch (error) {
			console.error("Error opening device:", error);
			this.setConnected(false);
			this.setStatus(
				`Failed to connect: ${error instanceof Error ? error.message : "Unknown error"}`
			);
		}
	}

	async disconnectDevice() {
		if (!this.device) return;
		try {
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
			this.connectedInterfaceNumber = null;
			this.outEndpointNumber = null;
			this.setConnected(false);
			this.setStatus("Disconnected");
			console.log("Device closed successfully");
		} catch (error) {
			console.error("Error closing device:", error);
			this.setStatus("Error disconnecting device");
		}
	}

	async send(namespaceId: number, messageId: number, payload: Uint8Array | ArrayBuffer) {
		if (!this.device || !this.deviceConnected) {
			throw new Error("Device not connected");
		}

		if (this.outEndpointNumber === null) {
			throw new Error("No output endpoint found");
		}

		const buffer = new ArrayBuffer(UsbService.FRAME_SIZE);
		const view = new DataView(buffer);

		// Write header (4 bytes)
		view.setUint16(0, namespaceId, true);
		view.setUint16(2, messageId, true);

		// Write payload starting at offset 4
		const payloadBytes = payload instanceof ArrayBuffer ? new Uint8Array(payload) : payload;
		const payloadView = new Uint8Array(buffer, 4);
		payloadView.set(payloadBytes.slice(0, UsbService.FRAME_SIZE - 4));

		const bytes = Array.from(new Uint8Array(buffer).slice(0, Math.min(8, 4 + payloadBytes.length)))
			.map(byte => "0x" + byte.toString(16).padStart(2, "0"))
			.join(" ");
		console.log(
			`Sending to endpoint ${this.outEndpointNumber}: [${bytes}] (ns=0x${namespaceId.toString(16)}, msg=0x${messageId.toString(16)}, len=${UsbService.FRAME_SIZE})`
		);

		try {
			const result = await this.device.transferOut(this.outEndpointNumber, buffer);
			console.log(`✓ Transfer successful, bytes written: ${result.bytesWritten}`);
			this.setStatus(`✓ Message sent (ns=0x${namespaceId.toString(16)}, msg=0x${messageId.toString(16)})`);
		} catch (error) {
			console.error("Error sending data:", error);
			const message = error instanceof Error ? error.message : String(error);
			this.setStatus(`Error: ${message}`);
			throw error;
		}
	}

}