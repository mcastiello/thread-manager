

class WebThread extends Worder {
    constructor(url) {
        super(url);
        
        this.addEventListener("message", event => {
            if (event.data === "thread-terminate") {
                event.stopImmediatePropagation();
                
                this.terminate();
            }
        }
    }
    
    terminate() {
        const event = new Event("terminate");
        
        this.dispatchEvent(event);
        
        super.terminate();
    }
}

export default WebThread;
