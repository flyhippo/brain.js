import { Writable } from 'stream';

class TrainStream extends Writable {
  constructor(opts = {}) {
    super({ objectMode: true });

    // require the neuralNetwork
    if (!opts.neuralNetwork) {
      throw new Error('no neural network specified');
    }

    this.neuralNetwork = opts.neuralNetwork;
    this.dataFormatDetermined = false;

    this.inputKeys = [];
    this.outputKeys = []; // keeps track of keys seen
    this.i = 0; // keep track of the for loop i variable that we got rid of
    this.iterations = opts.iterations || 20000;
    this.errorThresh = opts.errorThresh || 0.005;
    this.log = opts.log ? (typeof opts.log === 'function' ? opts.log : console.log) : false;
    this.logPeriod = opts.logPeriod || 10;
    this.callback = opts.callback;
    this.callbackPeriod = opts.callbackPeriod || 10;
    this.floodCallback = opts.floodCallback;
    this.doneTrainingCallback = opts.doneTrainingCallback;

    this.size = 0;
    this.count = 0;

    this.sum = 0;

    this.on('finish', this.finishStreamIteration);

    return this;
  }

  /*
   _write expects data to be in the form of a datum.
   ie. {input: {a: 1 b: 0}, output: {z: 0}}
   */
  _write(chunk, enc, next) {
    if (!chunk) { // check for the end of one interation of the stream
      this.emit('finish');
      return next();
    }

    if (!this.dataFormatDetermined) {
      this.size++;
      this.inputKeys = _.union(this.inputKeys, _.keys(chunk.input));
      this.outputKeys = _.union(this.outputKeys, _.keys(chunk.output));
      this.firstDatum = this.firstDatum || chunk;
      return next();
    }

    this.count++;

    let data = this.neuralNetwork.formatData(chunk);
    this.trainDatum(data[0]);

    // tell the Readable Stream that we are ready for more data
    next();
  }

  trainDatum(datum) {
    let err = this.neuralNetwork.trainPattern(datum.input, datum.output);
    this.sum += err;
  }

  finishStreamIteration () {
    if (this.dataFormatDetermined && this.size !== this.count) {
      console.log("This iteration's data length was different from the first.");
    }

    if (!this.dataFormatDetermined) {
      // create the lookup
      this.neuralNetwork.inputLookup = lookup.lookupFromArray(this.inputKeys);
      if(!_.isArray(this.firstDatum.output)){
        this.neuralNetwork.outputLookup = lookup.lookupFromArray(this.outputKeys);
      }

      let data = this.neuralNetwork.formatData(this.firstDatum)
        , inputSize = data[0].input.length
        , outputSize = data[0].output.length
        , hiddenSizes = this.hiddenSizes
        ;

      if (!hiddenSizes) {
        hiddenSizes = [Math.max(3, Math.floor(inputSize / 2))];
      }
      let sizes = _([inputSize, hiddenSizes, outputSize]).flatten();
      this.dataFormatDetermined = true;
      this.neuralNetwork.initialize(sizes);

      if (typeof this.floodCallback === 'function') {
        this.floodCallback();
      }
      return;
    }

    let error = this.sum / this.size;

    if (this.log && (this.i % this.logPeriod == 0)) {
      this.log("iterations:", this.i, "training error:", error);
    }
    if (this.callback && (this.i % this.callbackPeriod == 0)) {
      this.callback({
        error: error,
        iterations: this.i
      });
    }

    this.sum = 0;
    this.count = 0;
    // update the iterations
    this.i++;

    // do a check here to see if we need the stream again
    if (this.i < this.iterations && error > this.errorThresh) {
      if (typeof this.floodCallback === 'function') {
        return this.floodCallback();
      }
    } else {
      // done training
      if (typeof this.doneTrainingCallback === 'function') {
        return this.doneTrainingCallback({
          error: error,
          iterations: this.i
        });
      }
    }
  }
}