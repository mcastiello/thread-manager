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
 * This method is actually prepended to any callback before being executed as a web thread.
 * Its purpouse is to add a shared memory area that the thread can access.
 * This "shared" memory will be accessible both from the manager and from all the running threads.
 * @private
 */
const createSharedMemory = function() {
    let data = {};
    
    self.shared = new Proxy(data, {
        set: (ref, prop, val) {
            ref[prop] = val;
            
            self.postMessage({
                type: "shared-memory-updated",
                property: prop,
                value: val
            });
            
            return true;
        }
    });
    
    self.addEventListener("message", event => {
        if (event.data && event.data.type && event.data.type === "shared-memory-update") {
            data[event.data.property] = event.data.value;
            event.stopImmediatePropagation();
        }
        if (event.data && event.data.type && event.data.type === "shared-memory-init") {
            Object.assign(data, event.data.value);
            event.stopImmediatePropagation();
        }
    });
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
    if (threadQueue.length > 0 && threadRunning.length < threadLimit) {
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
            const stop = "self.stop=d=>postMessage({type:'thread-terminate',value:d);";
            const func = "(" + threadFunction.toString() + ")();";
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
            const thread = new WebThread(url);

            // Listen for the termination event.
            thread.addEventListener("terminate", event => threadTerminated(thread));
            
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
 * @type {ThreadManafer}
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
        threadQueue = [];
        for (let thread of threadRunning) {
            thread.terminate();
        }
    }
}

export default new ThreadManager();
