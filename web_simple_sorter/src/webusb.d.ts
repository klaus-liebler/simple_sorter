// WebUSB type definitions
interface USBDeviceFilter {
	vendorId?: number;
	productId?: number;
	classCode?: number;
	subclassCode?: number;
	protocolCode?: number;
	serialNumberPattern?: string;
}

interface USBDevice extends EventTarget {
	opened: boolean;
	productName?: string;
	manufacturerName?: string;
	serialNumber?: string;
	productId: number;
	vendorId: number;
	deviceVersionMajor: number;
	deviceVersionMinor: number;
	deviceVersionSubminor: number;
	usbVersionMajor: number;
	usbVersionMinor: number;
	usbVersionSubminor: number;
	deviceClass: number;
	deviceSubclass: number;
	deviceProtocol: number;
	configurations: USBConfiguration[];
	deviceDescriptor: USBDeviceDescriptor;
	open(): Promise<void>;
	close(): Promise<void>;
	selectConfiguration(configurationValue: number): Promise<void>;
	claimInterface(interfaceNumber: number): Promise<void>;
	releaseInterface(interfaceNumber: number): Promise<void>;
	selectAlternateInterface(
		interfaceNumber: number,
		alternateSetting: number
	): Promise<void>;
	clearHalt(direction: "in" | "out", endpointNumber: number): Promise<void>;
	transferIn(
		endpointNumber: number,
		length: number
	): Promise<USBInTransferResult>;
	transferOut(endpointNumber: number, data: BufferSource): Promise<USBOutTransferResult>;
	isochronousTransferIn(
		endpointNumber: number,
		lengths: number[]
	): Promise<USBIsochronousInTransferResult>;
	isochronousTransferOut(
		endpointNumber: number,
		data: BufferSource,
		packetLengths: number[]
	): Promise<USBIsochronousOutTransferResult>;
	controlTransferIn(
		setup: USBControlTransferParameters,
		length: number
	): Promise<USBInTransferResult>;
	controlTransferOut(
		setup: USBControlTransferParameters,
		data?: BufferSource
	): Promise<USBOutTransferResult>;
	reset(): Promise<void>;
}

interface USBDeviceDescriptor {
	bLength: number;
	bDescriptorType: number;
	bcdUSB: number;
	bDeviceClass: number;
	bDeviceSubClass: number;
	bDeviceProtocol: number;
	bMaxPacketSize0: number;
	idVendor: number;
	idProduct: number;
	bcdDevice: number;
	iManufacturer: number;
	iProduct: number;
	iSerialNumber: number;
	bNumConfigurations: number;
}

interface USBConfiguration {
	configurationValue: number;
	configurationName?: string;
	interfaces: USBInterface[];
	bLength: number;
	bDescriptorType: number;
	wTotalLength: number;
	bNumInterfaces: number;
	bConfigurationValue: number;
	iConfiguration: number;
	bmAttributes: number;
	bMaxPower: number;
}

interface USBInterface {
	interfaceNumber: number;
	alternates: USBAlternateInterface[];
	claimed: boolean;
}

interface USBAlternateInterface {
	alternateSetting: number;
	interfaceClass: number;
	interfaceSubclass: number;
	interfaceProtocol: number;
	interfaceName?: string;
	endpoints: USBEndpoint[];
	bLength: number;
	bDescriptorType: number;
	bInterfaceNumber: number;
	bAlternateSetting: number;
	bNumEndpoints: number;
	bInterfaceClass: number;
	bInterfaceSubClass: number;
	bInterfaceProtocol: number;
	iInterface: number;
}

interface USBEndpoint {
	endpointNumber: number;
	direction: "in" | "out";
	type: "bulk" | "interrupt" | "isochronous";
	packetSize: number;
	bLength: number;
	bDescriptorType: number;
	bEndpointAddress: number;
	bmAttributes: number;
	wMaxPacketSize: number;
	bInterval: number;
}

interface USBControlTransferParameters {
	requestType: "standard" | "class" | "vendor";
	recipient: "device" | "interface" | "endpoint" | "other";
	request: number;
	value: number;
	index: number;
}

interface USBTransferResult {
	status: "ok" | "stall" | "babble";
	bytesWritten?: number;
	bytesRead?: number;
	data?: DataView;
}

interface USBInTransferResult extends USBTransferResult {
	data: DataView;
	bytesRead: number;
}

interface USBOutTransferResult extends USBTransferResult {
	bytesWritten: number;
}

interface USBIsochronousTransferResult {
	data: DataView;
	packets: USBIsochronousTransferPacket[];
}

interface USBIsochronousInTransferResult extends USBIsochronousTransferResult {
	data: DataView;
	packets: USBIsochronousTransferPacket[];
}

interface USBIsochronousOutTransferResult {
	packets: USBIsochronousTransferPacket[];
}

interface USBIsochronousTransferPacket {
	status: "ok" | "stall" | "babble";
	bytesRead?: number;
	bytesWritten?: number;
}

interface USBConnectionEvent extends Event {
	device: USBDevice;
}

interface Navigator {
	usb: USB;
}

interface USB extends EventTarget {
	getDevices(): Promise<USBDevice[]>;
	requestDevice(options?: {
		filters?: USBDeviceFilter[];
		exclusionFilters?: USBDeviceFilter[];
	}): Promise<USBDevice>;
	readonly onconnect: ((this: USB, ev: USBConnectionEvent) => any) | null;
	readonly ondisconnect: ((this: USB, ev: USBConnectionEvent) => any) | null;
	addEventListener(
		type: "connect" | "disconnect",
		listener: (this: USB, ev: USBConnectionEvent) => any,
		options?: boolean | AddEventListenerOptions
	): void;
	removeEventListener(
		type: "connect" | "disconnect",
		listener: (this: USB, ev: USBConnectionEvent) => any,
		options?: boolean | EventListenerOptions
	): void;
}

type BufferSource = ArrayBuffer | ArrayBufferView;

declare module "*.css";
