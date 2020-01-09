
import WebThread from "./web-thread";

let threadCount = 0;

let threadLimit = 8;

const sharedMemory = {};

const sharedMemoryProxy = new Proxy(sharedMemory, {
    set: (ref, prop, val) => updateSharedMemory(prop, val)
});

const threadQueue = [];

const threadRunning = [];

const threadMap = new WeakMap();

const stopFunction = function() {
    self.postMessage("thread-terminate");
};

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

const updateSharedMemory = (property, value) => {
    sharedMemory[property] = value;
    for (let thread of threadRunning) {
        thread.postMessage({
            type: "shared-memory-update",
            property, value
        });
    }
};

const threadTerminated = thread => {
    const index = threadRunning.indexOf(thread);
    
    if (index >= 0) {
        threadRunning.splice(index, 1);
        threadCount--;
        
        updateThreadQueue();
    }
    
};

const updateThreadQueue = () => {
    if (threadQueue.length > 0 && threadCount < threadLimit) {
        const params = threadQueue.shift();
        
        executeThread(...params);
    }
};

const loadThreadUrl = threadFunction => {
    let url;
    
    if (typeof threadFunction === "function") {
        if (threadMap.has(threadFunction)) {
            url = threadMap.get(threadFunction);
        } else {
            const shared = "(" + createSharedMemory.toString() + ")();";
            const stop = "self.stop=function(){" + stopFunction.toString() + "};";
            const func = "(" + threadFunction.toString() + ")();";
            const blob = new Blob([shared+stop+func]);

            url = URL.createObjectURL(blob);

            threadMap.set(threadFunction, url);
        }
    }
    return url;
};

const createThread = threadFunction => {
    const url = loadThreadUrl(threadFunction);
    
    if (url) {
        try {
            const thread = new WebThread(url);

            thread.addEventListener("terminate", event => threadTerminated(thread));
            thread.addEventListener("message", event => {
                if (event.data && event.data.type && event.data.type === "shared-memory-updated") {
                    event.stopImmediatePropagation();
                    updateSharedMemory(event.data.property, event.data.value);
                }
            });
            
            thread.postMessage({
                type: "shared-memory-init",
                value: sharedMemory
            });

            threadRunning.push(thread);

            threadCount++;

            return thread;
        } catch {}
    }
};

const executeThread = (threadFunction, resolve, reject) => {
    const thread = createThread(threadFunction);

    if (thread) {
        resolve(thread);
    } else {
        updateThreadQueue();
        reject();
    }
};

class ThreadManager {

    run(threadFunction) {
        return new Promise((resolve, reject) => {
            if (threadCount < threadLimit) {
                executeThread(threadFunction, resolve, reject);
            } else {
                threadQueue.push([threadFunction, resolve, reject]);
            }
        });
    }

    get shared() {
        return sharedMemoryProxy;
    }

    get count() {
        return threadCount;
    }

    get running() {
        return threadRunning;
    }
    
    get limit() {
        return threadLimit;
    }
    
    set limit(value) {
        value = Number(value);
        
        if (!isNaN(value) && value > 0) {
            threadLimit = Math.round(value);
        }
    }
    
    purge() {
        threadQueue = [];
        for (let thread of threadRunning) {
            thread.terminate();
        }
    }
}

export default new ThreadManager();
