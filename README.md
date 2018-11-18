
mingcjs is a library intended to make processing binary data stored within ArrayBuffers easier and make JS to wasm/asm.js interop 
easier and more efficient. It can also be used with web applications that need reduced memory consumption and can afford
to use smaller packed datatypes like 8/16 bit integers.


The main cs_mempool_create function can be called with or without an options object to return a new flat arraybuffer based memory space. The options object has the structure:

{
  ERROR_HANDLER : (message : str) => never, //a function called when the library encounters a terrible error. defaults to throw new error(message)
  GP_MEM_SIZE : number, //The size of the general purpose memory segment. defaults to 128 kb.
  STACK_SIZE : number, //the size of the binary stack segment. defaults to 32 kb
  MEM_ARRAYBUFFER : ArrayBuffer | SharedArrayBuffer, //an already existing arraybuffer that we will allocate from. useful for wasm/asm.js interop and sharedarraybuffer communication between webworkers.
  MEM_ARRAYBUFFER_VIEW_START : number, //the offset within the arraybuffer where allocatable memory starts. Generally this would be used with pointers returned from a call to (wasm module/asm.js module)._malloc(size)

  MEM_ARRAYBUFFER_VIEW_END : number, //the offset at which allocatable memory ends. this ought to be (MEM_ARRAYBUFFER_VIEW_START + allocated size)
}


For the final two options note that mingcjs needs both start and end to be multiples of 8 to ensure that all usable arraybuffer view types can read the start and end. If they are not multiples of 8 it will align them, but that means you cannot rely on the allocated data explicitly starting at your given start and end if you do not do the alignment yourself, but you can rely on them lying within 8 bytes on either end of your provided values.

