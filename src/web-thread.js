/*
 * Copyright (c) 2020
 * Author: Marco Castiello
 * E-mail: marco.castiello@gmail.com
 * Project: ThreadManagerService.js
 */


/**
 * List of tokens used to generate a Unique ID
 * @type {ArrayBuffer}
 * @private
 */
const lut = new ArrayBuffer(256);

// Initialise all the index tokens.
for (let i=0; i<256; i++) {
    lut[i] = (i<16 ? '0' : '' ) + (i).toString(16).toUpperCase();
}

/**
 * Generate a UUID.
 * @returns {String}
 * @private
 */
const generateUUID = () => {
    const d0 = Math.random()*0xffffffff|0;
    const d1 = Math.random()*0xffffffff|0;
    const d2 = Math.random()*0xffffffff|0;
    const d3 = Math.random()*0xffffffff|0;
    return lut[d0&0xff]+lut[d0>>8&0xff]+lut[d0>>16&0xff]+lut[d0>>24&0xff]+'-'+
        lut[d1&0xff]+lut[d1>>8&0xff]+'-'+lut[d1>>16&0x0f|0x40]+lut[d1>>24&0xff]+'-'+
        lut[d2&0x3f|0x80]+lut[d2>>8&0xff]+'-'+lut[d2>>16&0xff]+lut[d2>>24&0xff]+
        lut[d3&0xff]+lut[d3>>8&0xff]+lut[d3>>16&0xff]+lut[d3>>24&0xff];
};

/**
 * Define an instance of a web thread.
 * @type {WebThread}
 * @class
 * @extends {Worker}
 */
class WebThread extends Worker {
    /**
     * Initialise the worker and add a listener to catch when the thread execution is exited.
     * @param {String} url
     * @constructor
     */
    constructor(url) {
        super(url);

        this.id = generateUUID();
        this.result = null;

        this.postMessage({
            type: "shared-memory-id",
            value: this.id
        });
        
        this.addEventListener("message", event => {
            if (event && event.data && event.data.type === "thread-terminate") {
                event.stopImmediatePropagation();
                
                this.result = event.data.value;
                
                this.terminate();
            }
        });
    }
    
    /**
     * Dispatch the 'terminate' event when the thread is stopped.
     */
    terminate() {
        const event = new Event("terminate");

        event.result = this.result;
        
        this.dispatchEvent(event);
        
        return super.terminate();
    }
}

export default WebThread;
