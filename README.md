# Thread Manager

As you know for sure, JS is a single thread language. In recent years, the introduction of Workers made that assumption not completely true. With a little bit of limitations, we are now able to execute some code in a parallel thread.

The library can be installed using `npm install thread-manager-service`.

The purpose of this library is to make the creation of workers slightly easier and to allow them to communicate with each other.

You won't need to create external files to define a worker, you can compile all the code inside the same file.

Let's start with a little example:
```javascript
import Threads from 'thread-manager-service';

const myAnnoyingFunction = function() {
    setInterval(() => console.log("I'm an annoying log!"), 100);
};

Threads.run(myAnnoyingFunction);
```
The above example define a simple callback which is then passed to the `run` method of the thread manager.

Internally that callback will be converted in an external javascript execution thread and, well, will annoy the hell out of you until you call `threads.running[0].terminate();`.

### Writing a thread callback
Thread callbacks are executed on a completely different scope, so, if you define or import things outside the callback, they won't be available inside it. Also, workes don't have access to the DOM and to the `window` object, so, don't even try to use it.

A good way to write a thread callback is to create a module that export just one function.
```javascript
// parallel-random.js
export default () => {
    shared[threadId] = Math.round(Math.random() * 100);
    
    exit();
};
```
And then import it and use it.
```javascript
// main.js
import RandomNumber from './parallel-random';
import Threads from 'thread-manager-service';

function getRandomNumbers(count) {
    const promises = [];
    
    for (let i = 0; i<count; i++) {
        promises.push(Threads.execute(RandomNumber));
    }
    
    Promise.all(promises).then(() => console.log(Object.values(Threads.shared)));
}

getRandomNumbers(6); // [45, 9, 1, 87, 58, 96]
```
Now, this is a very overcomplicated way to get 6 random numbers, but it helps to show a few new elements that we are going to describe now.
### Thread ID
Each thread has a UUID assigned to it, so you can use it to communicate with the other threads. Basically it's like a signature.
Inside the thread you can read it just using the variable `threadId`, while form the manager you can use one of the followings>
```javascript
Threads.run(MyProcess).then(thread => console.log(thread.id)); // "8301E902-5FE7-4EA1-AFBE-D6B410A2691D"

// or

console.log(Threads.running[0].id); // "8301E902-5FE7-4EA1-AFBE-D6B410A2691D"
```
### Shared memory
The first thing that the library add to your thread code is the ability to use a shared memory. The `shared` object is a proxy element that, every time you will update one of its properties, all the other running threads and the main thread manager will have access to that property.

Please not that you cannot store complex object into the shared memory, it is mainly meant to be used with strings, numbers and booleans. You can store arrays and basic objects, but the data won't get synchronized when you update one the inner properties of those objects. Also, if you try to use conplex objects, they will be converted into basic objects after the synchronization is completed.
```javascript
// First thread
export default () => {
    shared.num = 5;
    shared.arr = [1, 2, 3];
    
    shared.arr.push(4);
}

// Second thread
export default () => {
    console.log(shared.num); // 5
    console.log(shared.arr); // [1, 2, 3]
                             // It won't print the number 4 that has been added 
                             // through the push method.
    
    shared.arr = shared.arr.push(4);
}

// Third thread
export default () => {
    console.log(shared.num); // 5
    console.log(shared.arr); // [1, 2, 3, 4]
                             // Here it is, the 4 has been added because the 
                             // updated array has been reassigned to the shared 
                             // object.
}

// Main thread
import Threads from 'thread-manager-service';

console.log(Threads.shared); // { num: 5, arr: [1, 2, 3, 4] }
```
### Exiting a thread
When you work with workers, you know that you cannot kill one from the "inside", you need to dispatch a message that is then received by the main thread that then calls `worker.terminate()`... Too much code for me.

You can now call the `exit()` function that will terminate the thread and return control to the main thread. The function will also accept a parameter that will be returned to the main thread.

You can access the return values in 2 ways.
```javascript
// simple.js
export default () => {
    exit(5);
}

// Main thread
import Threads from 'thread-manager-service';
import simple from './simple';

async function example() {
    const t1 = await Threads.run(simple);
    simple.addEventListener("terminate", event => console.log(event.data));
    
    // or
    
    const value = await Threads.execute(simple);
    console.log(value);
}

example();
```
If the value passed to the `exit` function or any of the properties of such value implement the `Transferable` interface (`ArrayBuffer`, `MessagePort`, `ImageBitmap` and `OffscreenCanvas`) they will completely transferred to the Main thread as they are. Other type of data will be transferred as a copy and complex instances will be converted into a standard `Object`.
### Difference between `run` and `execute`
As you've seen, there are two methods that you can use to execute a thread, they both returns a promise, but they are resolved at different stages of the thread execution.

The method `run` will resolve the promise when the thread is created and initialised. The promise will return a reference to the created thread object. You will be then able to control your thread as a normal `Worker`.

The method `execute` will resolve the promise when the thread has finished its execution (using the `exit` function). The promise will return the result that has been passed to the `exit` function.

In line of principle, you should use `run` when you don't expect the thread to return a value and that probably will keep executing in a loop (like a service or similar). As long as the thread calls the `exit` function, you can use the `execute` method.

Even if the thread has an exit condition, you can still consider using `run` if you need to have control over it from the main thread. For example if there is a condition that, when verified, requires you to kill the thread. For example, you may have a download process that the user may want to kill from the UI by clicking a button.

### Thread concurrencies and queue
The library is set by default to run a maximum of `4` threads at the same time. If you try to run more than that, the new once will be added to a queue. As soon as one of the processes terminates, the next one in the queue will be executed.

The maximum number of thread can be changed to adapt to your needs (as long as you use a positive integer bigger than `0`). Be aware that if you try to reduce the number of concurrent threads, this won't kill the process in excess, the library will wait until the number of running processes will go below the set value before starting a new one from the queue. On the other side, if you increase the number of threads and there are some stored in the queue, those will be executed immediatly.
```javascript
import Threads from 'thread-manager-service';

console.log(Threads.limit); // 4

const myProcess = () => {
    console.log("I'm a process!");
    exit();
};

for (let i=0; i<8; i++) {
    Threads.run(myProcess);
}

console.log(Threads.count); // 4
console.log(Threads.queue); // 4

Threads.limit = 6;

console.log(Threads.count); // 6
console.log(Threads.queue); // 2
```
You will also have access to the currently running threads accessing the property `threads.running` which contains an array of all the `WebThread` instances created.

### Kill'em all
We've already seen how to use the `exit` function to stop the thread execution from the inside, but the `WebThread` class extends `Worker`, which means that you can also kill a thread using `wt.terminate();`.

If you are shutting down your application, you may want to kill all the threads at the same time, in order to do this. you can the manager method `threads.purge()` this will clean the queue and than go through all the running threads and call the `terminate` method.

Each of the threads will trigger the `terminate` event just before shutting down. You can use the event to read the result or make one last check to the shared memory to see what the thread has stored there for you as a partying gift.
