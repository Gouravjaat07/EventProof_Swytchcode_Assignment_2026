'use strict';

const { NotFoundError } = require('../../../shared/errors/app-error');

function notFound(req, res, next) {
  next(new NotFoundError('NOT_FOUND', `No route for ${req.method} ${req.path}.`));
}

module.exports = { notFound };
