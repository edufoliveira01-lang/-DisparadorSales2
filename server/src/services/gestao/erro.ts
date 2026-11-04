export class ErroGestao extends Error { constructor(m: string, public status = 400) { super(m); } }
