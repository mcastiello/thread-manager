/*
 * Copyright (c) 2020
 * Author: Marco Castiello
 * E-mail: marco.castiello@gmail.com
 * Project: ThreadManagerService.js
 */

const path = require('path');

module.exports = {
    entry: './src/index.js',
    output: {
        filename: 'thread-manager-service.js',
        path: path.resolve(__dirname, 'dist'),
    }
};
