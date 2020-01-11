/*
 * Copyright (c) 2020
 * Author: Marco Castiello
 * E-mail: marco.castiello@gmail.com
 * Project: ThreadManagerService.js
 */

import WebThread from "./web-thread";

/**
 * Maximum number of threads that can run at the same time.
 * @type {Number}
 */
let threadLimit = 4;

/**
 * Data object shared among the running threads.
 * @type {Object}
 */
const sharedMemory = {};

/**
 * Data proxy used to detect when property in the shared memory is changed.
 * @type {Proxy}
 */
const sharedMemoryProxy = new Proxy(sharedMemory, {
    set: (ref, prop, val) => updateSharedMemory(prop, val)
});

/**
 * List of callbacks awaiting for an execution slot.
 * @type {Array}
 */
const threadQueue = [];

/**
 * List of threads currently running.
 * @type {Array}
 */
const threadRunning = [];

/**
 * Map associating each callback with the generated internal URL used to launch a WebThread.
 * @type {Map}
 */
const threadMap = new WeakMap();

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
 * This method is actually prepended to any callback before being executed as a web thread.
 * Its purpose is to add a shared memory area that the thread can access.
 * This "shared" memory will be accessible both from the manager and from all the running threads.
 * @private
 */
const createSharedMemory = function() {
    let data = {};
    const proxy = new Proxy(data, {
        set: (ref, prop, val) => {
            ref[prop] = val;
            
            self.postMessage({
                type: "shared-memory-updated",
                property: prop,
                value: val
            });
            
            return true;
        }
    });

    Object.defineProperty(self, "shared", {
        "enumerable": false,
        "get": () => proxy
    });
    
    self.addEventListener("message", event => {
        if (event.data && event.data.type && event.data.type === "shared-memory-update") {
            data[event.data.property] = event.data.value;
            event.stopImmediatePropagation();
        }
        if (event.data && event.data.type && event.data.type === "shared-memory-id") {
            Object.defineProperty(self, "threadId", {
                "value": event.data.value,
                "enumerable": false,
                "writable": false
            });
            event.stopImmediatePropagation();
        }
        if (event.data && event.data.type && event.data.type === "shared-memory-init") {
            Object.assign(data, event.data.value);
            event.stopImmediatePropagation();
            start();
        }
    });
};

/**
 * Generate the exit function for the thread. The thread will be immediately terminated and the passed value will be
 * returned to the main thread.
 * If the value passed (or one of the properties of it) is an object that implements the Transferable interface,
 * the value will transferred completely to the main thread instead of neing converted into a standard object (which,
 * of course, make the transfer much quicker).
 * @param {*} value
 */
const exitFunction = value => {
    const params = [{
        type:'thread-terminate',
        value: value
    }];
    const transferable = [];
    const supportedTransferable = [
        "ArrayBuffer",
        "MessagePort",
        "ImageBitmap",
        "OffscreenCanvas"
    ];
    const isTransferable = obj => {
        let result = Boolean(obj);
        for (let cls of supportedTransferable) {
            if (result) {
                const ref = self[cls];
                if (ref) {
                    result = result && obj instanceof ref;
                }
            } else {
                break;
            }
        }
    };
    const checkForTransferable = obj => {
        if (isTransferable(obj)) {
            transferable.push(obj);
        } else if (obj && typeof obj === "object") {
            for (let i in obj) {
                const ref = obj[i];
                checkForTransferable(ref);
            }
        }
    };

    checkForTransferable(value);

    if (transferable.length > 0) {
        params.push(transferable);
    }
    self.postMessage(...params);
};

/**
 * Update the shared memory in the threads and in the manager.
 * @param {String} property
 * @param {*} value
 * @private
 */
const updateSharedMemory = (property, value) => {
    sharedMemory[property] = value;
    for (let thread of threadRunning) {
        thread.postMessage({
            type: "shared-memory-update",
            property, value
        });
    }
};

/**
 * When a thread is terminated, it is removed from the running 
 * list and the next one in the que is executed.
 * @param {WebThread} thread
 * @private
 */
const threadTerminated = thread => {
    const index = threadRunning.indexOf(thread);
    
    if (index >= 0) {
        threadRunning.splice(index, 1);
        
        updateThreadQueue();
    }
    
};

/**
 * If there is an execution slot available, it tries to run the next thread in the queue.
 * @private
 */
const updateThreadQueue = () => {
    while (threadQueue.length > 0 && threadRunning.length < threadLimit) {
        const params = threadQueue.shift();
        
        executeThread(...params);
    }
};

/**
 * Convert the provided callback into a string (adding the shared memory 
 * and the stop method) and it converts it into a Blob object.
 * It will return a URL to the locally stored object.
 * The URL will only generated once for each callback, if the thread is executed 
 * more than once, the same URL will be returned.
 * @param {Function} threadFunction
 * @returns {String}
 * @private
 */
const loadThreadUrl = threadFunction => {
    let url;
    
    if (typeof threadFunction === "function") {
        if (threadMap.has(threadFunction)) {
            url = threadMap.get(threadFunction);
        } else {
            const shared = "(" + createSharedMemory.toString() + ")();";
            const stop = "self.exit=d=>{(" + exitFunction.toString() + ")(d)};";
            const func = "let start=()=>{(" + threadFunction.toString() + ")();start=undefined};";
            const blob = new Blob([shared+stop+func]);

            url = URL.createObjectURL(blob);

            threadMap.set(threadFunction, url);
        }
    }
    return url;
};

/**
 * Create and start a new thread using the provided callback.
 * @param {Function} threadFunction
 * @private
 */
const createThread = threadFunction => {
    const url = loadThreadUrl(threadFunction);
    
    if (url) {
        try {
            const thread = new WebThread(url, generateUUID());

            // Listen for the termination event.
            thread.addEventListener("terminate", () => threadTerminated(thread));
            
            // Listen for any memory updates.
            thread.addEventListener("message", event => {
                if (event.data && event.data.type && event.data.type === "shared-memory-updated") {
                    event.stopImmediatePropagation();
                    updateSharedMemory(event.data.property, event.data.value);
                }
            });
            
            // Update the thread shared memory.
            thread.postMessage({
                type: "shared-memory-init",
                value: sharedMemory
            });

            threadRunning.push(thread);

            return thread;
        } catch {}
    }
};

/**
 * Try to create a new thread and resolve the promise.
 * If the creation fails, the promise will be rejected.
 * @param {Function} threadFunction
 * @param {Function} resolve
 * @param {Function} reject
 * @private
 */
const executeThread = (threadFunction, resolve, reject) => {
    const thread = createThread(threadFunction);

    if (thread) {
        resolve(thread);
    } else {
        updateThreadQueue();
        reject();
    }
};

/**
 * Defaine the manager used to run and handle all the threads.
 * @type {ThreadManager}
 * @class
 */
class ThreadManager {

    /**
     * Get access to the thread shared memory.
     * @returns {Proxy}
     */
    get shared() {
        return sharedMemoryProxy;
    }

    /**
     * Get the count of running threads.
     * @returns {Number}
     */
    get count() {
        return threadRunning.length;
    }

    /**
     * Get the count of queued threads.
     * @returns {Number}
     */
    get queue() {
        return threadQueue.length;
    }

    /**
     * Get a list of running threads.
     * @returns {Array}
     */
    get running() {
        return threadRunning.slice();
    }
    
    /**
     * Get the maximum number of threads that can run at the same time.
     * @returns {Number}
     */
    get limit() {
        return threadLimit;
    }
    
    /**
     * Set the maximum number of threads that can run at the same time.
     * The value cannot be less than 1 and reducing the amount of maximum thread won't cause 
     * the currently running one to stop, it will just make the wait for the ones in the queue 
     * a bit longer.
     * @param {Number} value
     */
    set limit(value) {
        value = Number(value);
        
        if (!isNaN(value) && value >= 1) {
            threadLimit = Math.round(value);
            updateThreadQueue();
        }
    }

    /**
     * Initialise a thread using the provided callback. If there are no execution 
     * slots available, the callback will be put in a queue and the promise will only 
     * be resolved when the thread is actually started.
     * @param {function} threadFunction
     * @returns {Promise<WebThread>}
     */
    run(threadFunction) {
        return new Promise((resolve, reject) => {
            if (threadRunning.length < threadLimit) {
                executeThread(threadFunction, resolve, reject);
            } else {
                threadQueue.push([threadFunction, resolve, reject]);
            }
        });
    }
    
    /**
     * Execute the callback asynchronously in a separate thread. 
     * The promise will be resolved with the value passed to stop method inside the thread.
     * @param {function} threadFunction
     * @returns {Promise<*>}
     */
    async execute(threadFunction) {
        const thread = await this.run(threadFunction);
        const result = await new Promise(resolve => {
            thread.addEventListener("terminate", event => resolve(event.result));
        });
        
        return result;
    }
    
    /**
     * Kill all the running threads.
     */
    purge() {
        const threads = threadRunning.slice();

        threadQueue.length = 0;

        for (let thread of threads) {
            thread.terminate();
        }
    }

    /**
     * Expose the method to generate the UUID.
     * @returns {String}
     */
    generateUUID() {
        return generateUUID();
    }
}

export default new ThreadManager();
