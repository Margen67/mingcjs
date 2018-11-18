
mingcjs is a library intended to make processing binary data stored within ArrayBuffers easier and make JS to wasm/asm.js interop 
easier and more efficient. It can also be used with web applications that need reduced memory consumption and can afford
to use smaller packed datatypes like 8/16 bit integers.


The main cs_mempool_create function can be called with or without an options object to return a new flat arraybuffer based memory space. The options object has the structure:
```javascript
{

  ERROR_HANDLER : (message : str) => never, //a function called when the library encounters a terrible error. defaults to throw new error(message)
  
  GP_MEM_SIZE : number, //The size of the general purpose memory segment. defaults to 128 kb.
  
  STACK_SIZE : number, //the size of the binary stack segment. defaults to 32 kb
  
  MEM_ARRAYBUFFER : ArrayBuffer | SharedArrayBuffer, //an already existing arraybuffer that we will allocate from. useful for wasm/asm.js interop and sharedarraybuffer communication between webworkers.
  
  MEM_ARRAYBUFFER_VIEW_START : number, //the offset within the arraybuffer where allocatable memory starts. Generally this would be used with pointers returned from a call to (wasm module/asm.js module)._malloc(size)

  MEM_ARRAYBUFFER_VIEW_END : number, //the offset at which allocatable memory ends. this ought to be (MEM_ARRAYBUFFER_VIEW_START + allocated size)
  
}
```

For the final two options note that mingcjs needs both start and end to be multiples of 8 to ensure that all usable arraybuffer view types can read the start and end. If they are not multiples of 8 it will align them, but that means you cannot rely on the allocated data explicitly starting at your given start and end if you do not do the alignment yourself, but you can rely on them lying within 8 bytes on either end of your provided values.

cs_mempool_create will return an object with the following fields if your options were all valid:

{
        stack_frame_end,
        stack_frame_begin,
        allocate,
        deallocate,
        memcopy,
        memset,
        zeromem,
        store_string,
        read_string,
        write_u32,
        write_i32,
        write_f32,
        write_u16,
        write_i16,
        write_i8,
        write_u8,
        read_f32,
        read_i8,
        read_i16,
        read_i32,
        read_u16,
        read_u8,
        read_u32,
        iread_f32,
        iread_u32,
        iread_i32,
        iread_u16,
        iread_i16,
        iread_u8,
        iread_i8,
        iwrite_f32,
        iwrite_u32,
        iwrite_i32,
        iwrite_u16,
        iwrite_i16,
        iwrite_u8,
        iwrite_i8,
        create_native_class,
        create_native_stack_class,
        build_lookaside_list,
        destroy_lookaside_list,
        base_arraybuffer,
        FUTEX_WAITED,
        FUTEX_WASNE,
        FUTEX_TIMED_OUT
    }
    
    Before diving into all of these I should probably provide a quick example of using the library, then give context because this might look a little intimidating to the uninitiated.

{
  const mempool = cs_mempool_create();
  
  //create a wrapper class for a 4x4 matrix
  //that is stored within a flat arraybuffer memory space
  
  const class_matrix4x4 = mempool.create_native_class('0', 'f32''1', 'f32''2', 'f32''3', 'f32''4', 'f32''5', 'f32''6', 'f32''7', 'f32''8', 'f32''9', 'f32''10', 'f32''11', 'f32''12', 'f32''13', 'f32''14', 'f32''15', 'f32');
  
  //generate a list of 1024 preallocated 4x4 matrices that are contiguously allocated within this memory space
  //this is the ideal way to use the library, you can dynamically allocate but my allocator isnt too great performance wise,
  //so instead you build these singly-linked lists. when allocating an entry, it simply grabs the list head
  //places the entry into the "avail" list for when a mat4 is freed and needs to be inserted
  //back to the head of the list, and returns the pointer into the flat space
  const preallocated_mat4x4 = mempool.build_lookaside_list(class_matrix4x4.sizeof, 1024);
  
  //lets allocate a mat4
  const mat4_offset = preallocated_mat4x4.alloc();
  
  console.log(typeof mat4_offset); // will be "number" because its just a primitive offset into the memory space
  
  //now lets use a wrapper object
  
  const mat4_proxy = new class_matrix4x4();
  //these proxy objects have only one true field, ptr, which is a memory space offset
  mat4_proxy.ptr = mat4_offset;
  
  //now we can do whatever we want with this mat4. we can access 0-15
  //note that proxy objects are not dependent on the memory space until you give them a ptr.
  //but ptr can be reassigned if its freed elsewhere or managed by a lookaside list.
  
  
}

The proxy objects are not necessary and you can do without them if you use the write/read/iwrite/iread functions instead (indexed write, indexed read, direct binary write, direct binary read) but those can get a bit confusing when your data becomes complex. 

Proxy objects can be preallocated in an iife like so:

const do_mat4x4_op = (function() {
  const matv0 = new class_matrix4x4();
  const matv1 = new class_matrix4x4();
  return function(matp0, matp1) {
    matv0.ptr = matp0;
    matv1.ptr = matp1;
    //do something with the matrices
    
  };
})();

In WebGL libraries it is common to use Float32Array instances for matrices. However typed array allocation is relatively expensive compared to standard arrays, partly because typed arrays do not exist on the main JS heap and the JS engine has to do extra bookkeeping on them. Using preallocated slices of a single typed array view overall is more efficient, but impractical without a decent wrapper. Here's hoping this ones decent.



/*
  more documentation. eventually
*/
    
    
