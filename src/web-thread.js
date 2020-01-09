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
class WebThread extends Worder {
    /**
     * Initialise the worker and add a listener to catch when the thread execution is exited.
     * @param {String} url
     * @constructor
     */
    constructor(url) {
        super(url);
        
        this.addEventListener("message", event => {
            if (event && event.data && event.data.type === "thread-terminate") {
                event.stopImmediatePropagation();
                
                this.result = event.data.value
                
                this.terminate();
            }
        }
    }
    
    /**
     * Distatch the 'terminate' event when the thread is stopped.
     */
    terminate() {
        const event = new Event("terminate");
        
        this.dispatchEvent(event, {
            result: this.result
        });
        
        return super.terminate();
    }
}

export default WebThread;
