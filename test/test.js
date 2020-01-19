/*
 * Copyright (c) 2020
 * Author: Marco Castiello
 * E-mail: marco.castiello@gmail.com
 * Project: ThreadManagerService.js
 */

// Mocking the Blob class to make sure that the text method exists.
class MockBlob extends Blob {
    constructor(parts) {
        super(parts);
        this.parts = parts.slice();
    }

    async text() {
        return this.parts.join(";");
    }
}

self.Blob = MockBlob;
self.EventTarget = null;
self.URL = {
    createObjectURL: blob => blob
};

const Threads = require('../src/thread-manager.js').default;

describe("Threads manager", () => {

    it("should create a thread out of a function", done => {
        const thread = () => {
            postMessage("Hello World!");
        };

        Threads.run(thread).then(th => {
            th.addEventListener("message", evt => {
                expect(Threads.count === 1).toBeTruthy();
                expect(Threads.running[0] === th).toBeTruthy();
                expect(evt.data === "Hello World!").toBeTruthy();

                Threads.purge();
                done();
            });
        });
    });
    it("should terminate a running thread", done => {
        const thread = () => {
            postMessage("Hello World!");
        };

        Threads.run(thread).then(th => {
            th.addEventListener("message", evt => {
                expect(Threads.count === 1).toBeTruthy();
                expect(Threads.running[0] === th).toBeTruthy();

                th.terminate();

                expect(Threads.count === 0).toBeTruthy();
                done();
            });
        });
    });
    it("should share the thread ID", done => {
        const thread = () => {
            postMessage(threadId);
        };

        Threads.run(thread).then(th => {
            th.addEventListener("message", evt => {
                expect(evt.data === th.id).toBeTruthy();

                th.terminate();

                done();
            });
        });
    });
    it("should share data with the main thread", done => {
        const thread = () => {
            shared.greetings = "Hello World!";
        };

        Threads.run(thread).then(th => {
            setTimeout(() => {
                expect(Threads.shared.greetings === "Hello World!").toBeTruthy();

                th.terminate();

                done();
            }, 100);
        });
    });
    it("should share data from the main thread", done => {
        const thread = () => {
            postMessage(shared.greetings);
        };

        Threads.shared.greetings = "Hello World!";

        Threads.run(thread).then(th => {
            th.addEventListener("message", evt => {
                expect(evt.data === "Hello World!").toBeTruthy();

                th.terminate();

                done();
            }, 100);
        });
    });
    it("should share data between 2 threads", done => {
        const thread1 = () => {
            shared.greetings = "Hello World!";
        };
        const thread2 = () => {
            setTimeout(
                postMessage(shared.greetings === "Hello World!"), 100
            );
        };

        Threads.shared.greetings = "Hello World!";

        Threads.run(thread1);
        Threads.run(thread2).then(th => {
            th.addEventListener("message", evt => {
                expect(evt.data).toBeTruthy();

                Threads.purge();

                done();
            }, 100);
        });
    });
    it("should return a value to the main thread", async () => {
        const thread1 = () => {
            exit("Hello World!");
        };
        const thread2 = () => {
            const buffer = new ArrayBuffer(5);

            exit(buffer);
        };

        const value1 = await Threads.execute(thread1);
        const value2 = await Threads.execute(thread2);

        expect(value1 === "Hello World!").toBeTruthy();
        expect(value2 instanceof ArrayBuffer).toBeTruthy();
        expect(value2.byteLength === 5).toBeTruthy();
    });
    it("should run a limited number of threads", () => {
        const thread = () => {
            postMessage("Hello World!");
        };
        for (let i=0; i<8; i++) {
            Threads.run(thread);
        }
        expect(Threads.limit === 4).toBeTruthy();
        expect(Threads.count === 4).toBeTruthy();
        expect(Threads.queue === 4).toBeTruthy();

        Threads.limit = 6;
        expect(Threads.limit === 6).toBeTruthy();
        expect(Threads.count === 6).toBeTruthy();
        expect(Threads.queue === 2).toBeTruthy();

        Threads.purge();
        expect(Threads.count === 0).toBeTruthy();
        expect(Threads.queue === 0).toBeTruthy();
    });
});