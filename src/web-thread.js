/*
 * Copyright (c) 2020
 * Author: Marco Castiello
 * E-mail: marco.castiello@gmail.com
 * Project: ThreadManagerService.js
 */

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
     * @param {String} id
     * @constructor
     */
    constructor(url, id) {
        super(url);

        this.id = id;
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
